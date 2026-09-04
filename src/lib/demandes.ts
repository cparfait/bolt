import { prisma } from "./db";
import { getGeneralSettings, urlEspaceAgent } from "./settings";
import { creerParticipantHorsAnnuaire } from "./comptes";
import { nomPourSalutation } from "./constants";
import { envoyerMail } from "./mail";
import { audit } from "./audit";

/**
 * Demandes d'accès des personnes hors annuaire.
 *
 * Le principe qui gouverne ce fichier : **le mécanisme d'accès ne crée jamais
 * d'identité**. Un code ou un lien reçu par courriel prouve qu'on est titulaire
 * d'une boîte, rien de plus — il authentifie, il n'autorise pas. Si une adresse
 * quelconque suffisait à obtenir un compte, le formulaire publié sur Internet
 * serait une inscription libre à un outil interne.
 *
 * Une demande n'est donc rien du tout : ni compte, ni session, ni droit. Elle
 * attend qu'un gestionnaire décide. C'est ce qui permet de publier le
 * formulaire sans ouvrir de porte.
 */

/** Une seule demande en attente par adresse : on n'empile pas la même personne. */
export type DepotResultat = "enregistree" | "deja" | "ignoree";

const NOTIF_MAX_PAR_HEURE = 20;

/**
 * Enregistre une demande d'accès.
 *
 * Ne renvoie JAMAIS d'information sur ce que Bolt sait déjà : le retour ne
 * distingue pas une adresse inconnue d'une adresse déjà titulaire d'un compte.
 * Publié sur Internet, ce formulaire serait sinon un moyen de confirmer qu'une
 * personne travaille dans la collectivité — précisément ce que
 * `envoyerLienConnexion` refuse de laisser faire.
 */
export async function deposerDemande(donnees: {
  nom: string;
  email: string;
  service?: string | null;
  message?: string | null;
  ip?: string | null;
}): Promise<DepotResultat> {
  const email = donnees.email.trim().toLowerCase();

  // Adresse déjà connue : la personne a déjà un accès, elle doit passer par
  // /acces. On ne le lui dit pas — on ne crée simplement pas de demande, que le
  // service des sports aurait à traiter pour rien.
  const connu = await prisma.user.findFirst({
    where: {
      active: true,
      OR: [
        { email: { equals: email, mode: "insensitive" } },
        { emailContact: { equals: email, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  if (connu) return "ignoree";

  const enCours = await prisma.demandeAcces.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, statut: "EN_ATTENTE" },
    select: { id: true },
  });
  if (enCours) return "deja";

  const demande = await prisma.demandeAcces.create({
    data: {
      nom: donnees.nom,
      email,
      service: donnees.service?.trim() || null,
      message: donnees.message?.trim() || null,
      ip: donnees.ip || null,
    },
  });

  await audit("DEMANDE_ACCES_DEPOSEE", { cible: donnees.nom, details: email });
  await prevenirLeService(demande.id);
  return "enregistree";
}

/**
 * Prévient le service des sports qu'une demande attend.
 *
 * Le courriel part vers `contactEmail`, une adresse FIXE et interne : le
 * formulaire ne permet donc pas de faire écrire la collectivité à une adresse
 * choisie par le demandeur. Reste un risque de saturation de cette boîte-là, si
 * quelqu'un dépose des demandes en série. D'où un plafond horaire : au-delà, la
 * demande est quand même enregistrée — elle apparaîtra dans le back-office —
 * mais l'avis n'est pas envoyé. Perdre un avis coûte un délai ; noyer la boîte
 * du service coûte tous les avis suivants.
 */
async function prevenirLeService(demandeId: string): Promise<void> {
  const g = await getGeneralSettings();
  if (!g.contactEmail) return;

  const { rateLimit } = await import("./rate-limit");
  if (!rateLimit("demande-acces:notif", NOTIF_MAX_PAR_HEURE, 3600).ok) {
    await audit("DEMANDE_ACCES_PLAFOND", { details: demandeId });
    return;
  }

  const demande = await prisma.demandeAcces.findUnique({ where: { id: demandeId } });
  if (!demande) return;

  const enAttente = await prisma.demandeAcces.count({ where: { statut: "EN_ATTENTE" } });
  const base = (g.appUrl || "").replace(/\/+$/, "");

  await envoyerMail(
    g.contactEmail,
    `Demande d'accès à ${g.appName} : ${demande.nom}`,
    [
      `Une personne absente de l'annuaire demande un accès à ${g.appName}.`,
      [
        `Nom : ${demande.nom}`,
        `Adresse : ${demande.email}`,
        demande.service ? `Service ou organisme : ${demande.service}` : null,
        demande.message ? `Précisions : ${demande.message}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      `Aucun compte n'a été créé. Rien ne part vers cette adresse tant que vous n'avez pas validé la demande.`,
      base
        ? `[Traiter la demande](${base}/agents/demandes)`
        : `À traiter dans ${g.appName}, écran « Demandes d'accès ».`,
      enAttente > 1 ? `${enAttente} demandes attendent une décision.` : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

/**
 * Valide une demande : crée le compte hors annuaire et prévient la personne.
 *
 * C'est ici, et seulement ici, qu'une identité naît d'une adresse saisie sur
 * Internet — après une décision humaine. L'adresse est écrite dans `email` du
 * compte créé : c'est un compte `no_ad.`, aucune synchronisation d'annuaire ne
 * viendra l'écraser.
 */
export async function validerDemande(
  demandeId: string,
  gestionnaire: { id: string; displayName: string },
  // Rattachement choisi par le gestionnaire au moment de valider. Le service
  // déclaré par le demandeur est un texte libre — « Dsi » ne se raccorde pas à
  // « DSI » — et la fréquentation par direction se répartirait sur autant de
  // lignes que d'orthographes. Absent : on retombe sur ce qui a été déclaré.
  rattachement: { direction?: string | null; service?: string | null } = {},
): Promise<{ ok: boolean; message: string }> {
  const demande = await prisma.demandeAcces.findUnique({ where: { id: demandeId } });
  if (!demande) return { ok: false, message: "Demande introuvable." };
  if (demande.statut !== "EN_ATTENTE") {
    return { ok: false, message: "Cette demande a déjà été traitée." };
  }

  // La personne a pu obtenir un compte entre-temps — un vrai compte AD, ou une
  // création à la main par le service. On ne fabrique pas de doublon.
  const existant = await prisma.user.findFirst({
    where: {
      active: true,
      OR: [
        { email: { equals: demande.email, mode: "insensitive" } },
        { emailContact: { equals: demande.email, mode: "insensitive" } },
      ],
    },
    select: { id: true, displayName: true },
  });
  if (existant) {
    await prisma.demandeAcces.update({
      where: { id: demandeId },
      data: {
        statut: "VALIDEE",
        decidePar: gestionnaire.displayName,
        decideAt: new Date(),
        userId: existant.id,
        motif: "Compte déjà existant",
      },
    });
    return {
      ok: true,
      message: `${existant.displayName} avait déjà un compte : la demande est classée, aucun doublon créé.`,
    };
  }

  const user = await creerParticipantHorsAnnuaire({
    nom: demande.nom,
    email: demande.email,
    direction: rattachement.direction?.trim() || null,
    service: rattachement.service?.trim() || demande.service,
  });

  await prisma.demandeAcces.update({
    where: { id: demandeId },
    data: {
      statut: "VALIDEE",
      decidePar: gestionnaire.displayName,
      decideAt: new Date(),
      userId: user.id,
    },
  });

  await audit("DEMANDE_ACCES_VALIDEE", {
    userId: gestionnaire.id,
    cible: demande.nom,
    details: user.login,
  });
  await annoncerAcces(user.id);

  return { ok: true, message: `${demande.nom} a un accès (identifiant ${user.login}).` };
}

/**
 * Annonce à la personne que son accès est ouvert.
 *
 * On envoie l'adresse de l'espace agent, pas un lien de connexion : un jeton
 * vaut trente minutes, et ce courriel-ci peut être lu le lendemain. La personne
 * demandera son lien quand elle en aura besoin.
 */
async function annoncerAcces(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.email) return;
  const g = await getGeneralSettings();
  const base = urlEspaceAgent(g);

  const envoi = await envoyerMail(
    user.email,
    `Votre accès à ${g.appName} est ouvert`,
    [
      `Bonjour ${nomPourSalutation(user.displayName)},`,
      `Le service des sports a validé votre demande : vous pouvez désormais consulter les activités et vous y inscrire.`,
      `Pour vous connecter, indiquez cette adresse e-mail : vous recevrez un lien. Aucun mot de passe ne vous sera demandé.`,
      base ? `[Accéder aux activités](${base}/acces)` : null,
      g.contactEmail ? `Une question ? Écrivez au service des sports : ${g.contactEmail}` : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
  await audit(envoi.ok ? "ACCES_ANNONCE" : "ACCES_ANNONCE_ECHEC", {
    userId: user.id,
    details: envoi.ok ? undefined : envoi.message,
  });
}

/**
 * Refuse une demande.
 *
 * Aucun courriel ne part : le demandeur n'a pas à apprendre, depuis Internet,
 * ce que la collectivité décide de son cas — et un refus notifié
 * automatiquement se retourne en source de litige. Le motif reste interne ;
 * c'est au service des sports de reprendre contact s'il le juge utile.
 */
export async function refuserDemande(
  demandeId: string,
  motif: string,
  gestionnaire: { id: string; displayName: string },
): Promise<{ ok: boolean; message: string }> {
  const demande = await prisma.demandeAcces.findUnique({ where: { id: demandeId } });
  if (!demande) return { ok: false, message: "Demande introuvable." };
  if (demande.statut !== "EN_ATTENTE") {
    return { ok: false, message: "Cette demande a déjà été traitée." };
  }

  await prisma.demandeAcces.update({
    where: { id: demandeId },
    data: {
      statut: "REFUSEE",
      decidePar: gestionnaire.displayName,
      decideAt: new Date(),
      motif: motif.trim() || null,
    },
  });
  await audit("DEMANDE_ACCES_REFUSEE", {
    userId: gestionnaire.id,
    cible: demande.nom,
    details: demande.email,
  });
  return { ok: true, message: `Demande de ${demande.nom} refusée.` };
}

export function compterDemandesEnAttente(): Promise<number> {
  return prisma.demandeAcces.count({ where: { statut: "EN_ATTENTE" } });
}

/**
 * Refuse d'un coup toutes les demandes en attente.
 *
 * Le pendant du plafond horaire : celui-ci borne ce qui entre, celui-là permet
 * d'en sortir. Sans lui, une vague de dépôts automatisés laisserait le service
 * des sports devant des centaines de fiches à traiter une par une — la
 * prévention tenait, la remise en état non.
 *
 * Refuse plutôt que supprime : la trace de ce qui est arrivé reste, et une
 * personne dont la demande légitime aurait été emportée peut la redéposer.
 */
export async function refuserEnAttente(
  motif: string,
  gestionnaire: { id: string; displayName: string },
): Promise<number> {
  const res = await prisma.demandeAcces.updateMany({
    where: { statut: "EN_ATTENTE" },
    data: {
      statut: "REFUSEE",
      decidePar: gestionnaire.displayName,
      decideAt: new Date(),
      motif: motif.trim() || "Refus groupé",
    },
  });
  if (res.count > 0) {
    await audit("DEMANDES_ACCES_REFUS_GROUPE", {
      userId: gestionnaire.id,
      details: `${res.count} demande(s)`,
    });
  }
  return res.count;
}

/**
 * Supprime définitivement les demandes refusées.
 *
 * Les validées, elles, ne sont jamais supprimées à la main : elles documentent
 * la création d'un compte, et c'est ce qu'on ressort quand on se demande d'où
 * vient telle personne dans la liste. Elles partent avec la purge, à leur
 * échéance.
 */
export async function supprimerRefusees(gestionnaire: {
  id: string;
  displayName: string;
}): Promise<number> {
  const res = await prisma.demandeAcces.deleteMany({ where: { statut: "REFUSEE" } });
  if (res.count > 0) {
    await audit("DEMANDES_ACCES_SUPPRIMEES", {
      userId: gestionnaire.id,
      details: `${res.count} demande(s) refusée(s)`,
    });
  }
  return res.count;
}
