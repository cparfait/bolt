import { prisma } from "./db";
import { FREQUENCES_AVIS, type FrequenceAvis } from "./frequences";
import { getGeneralSettings, getSetting, setSetting, urlEspaceAgent } from "./settings";
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

  await prisma.demandeAcces.create({
    data: {
      nom: donnees.nom,
      email,
      service: donnees.service?.trim() || null,
      message: donnees.message?.trim() || null,
      ip: donnees.ip || null,
    },
  });

  await audit("DEMANDE_ACCES_DEPOSEE", { cible: donnees.nom, details: email });
  // Aucun avis immédiat : c'est `declencherAvisDemandesSiBesoin` qui prévient
  // le service, au rythme qu'il a choisi. Un courriel par dépôt devenait du
  // bruit dès la rentrée.
  return "enregistree";
}

/**
 * Avis périodique : « des demandes attendent une décision ».
 *
 * Un courriel par dépôt paraissait la bonne idée. Il l'est tant qu'il y a deux
 * demandes par mois ; à la rentrée, il devient du bruit — et le bruit finit
 * dans une règle de tri, ce qui coûte plus cher que de l'avoir manqué.
 *
 * Trois choix tiennent ce mécanisme :
 *
 *  • **rien ne part si la file est vide.** Ce n'est pas un rapport périodique,
 *    c'est un rappel de ce qui attend. Un créneau sans demande ne consomme donc
 *    pas son tour : la première demande déposée après lui déclenchera le
 *    suivant, sans attendre un cycle de plus ;
 *  • **le créneau, pas l'horloge.** On repère le dernier créneau passé et on
 *    vérifie qu'il n'a pas déjà servi. L'ordonnanceur bat toutes les cinq
 *    minutes, et une comparaison d'horaires exacte raterait le créneau à chaque
 *    redémarrage tombé au mauvais moment ;
 *  • **le verrou est en base.** Deux instances de l'application n'enverraient
 *    pas l'avis en double, et un redéploiement ne le rejoue pas.
 */
const CLE_DERNIER_AVIS = "demandes:dernierAvis";

/**
 * Identifiant du dernier créneau d'envoi échu, ou null s'il n'y en a pas eu
 * aujourd'hui. Exporté pour être testable : c'est toute la logique de rythme,
 * et elle est invisible à la relecture.
 */
export function creneauEchu(
  maintenant: Date,
  frequence: FrequenceAvis,
): string | null {
  const { heures, jour } = FREQUENCES_AVIS[frequence];
  if (jour !== null && maintenant.getDay() !== jour) return null;

  const passees = heures.filter((h) => maintenant.getHours() >= h);
  if (passees.length === 0) return null;

  const h = passees[passees.length - 1];
  const jourIso = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, "0")}-${String(maintenant.getDate()).padStart(2, "0")}`;
  return `${jourIso}#${String(h).padStart(2, "0")}`;
}

/** Appelé par l'ordonnanceur. Silencieux : un avis raté ne casse rien. */
export async function declencherAvisDemandesSiBesoin(): Promise<void> {
  try {
    const enAttente = await compterDemandesEnAttente();
    // File vide : on ne consomme même pas le créneau. La prochaine demande
    // déposée sera signalée au créneau suivant, pas dans deux jours.
    if (enAttente === 0) return;

    const g = await getGeneralSettings();
    if (!g.contactEmail) return;

    const creneau = creneauEchu(new Date(), g.frequenceAvisDemandes);
    if (!creneau) return;
    if ((await getSetting<string>(CLE_DERNIER_AVIS)) === creneau) return;

    // Verrou posé AVANT l'envoi : deux battements simultanés n'enverraient
    // qu'un avis. Au pire, un avis est perdu — jamais doublé.
    await setSetting(CLE_DERNIER_AVIS, creneau);

    const demandes = await prisma.demandeAcces.findMany({
      where: { statut: "EN_ATTENTE" },
      orderBy: { createdAt: "asc" },
      take: 15,
    });
    const base = (g.appUrl || "").replace(/\/+$/, "");

    await envoyerMail(
      g.contactEmail,
      `${g.appName} — ${enAttente} demande${enAttente > 1 ? "s" : ""} d'accès à traiter`,
      [
        enAttente === 1
          ? `Une personne absente de l'annuaire attend un accès à ${g.appName}.`
          : `${enAttente} personnes absentes de l'annuaire attendent un accès à ${g.appName}.`,
        demandes
          .map((d) => `— ${d.nom} (${d.email})${d.service ? ` · ${d.service}` : ""}`)
          .join("\n") + (enAttente > demandes.length ? `\n— … et ${enAttente - demandes.length} autre(s)` : ""),
        `Aucun compte n'est créé, et rien ne part vers ces adresses tant que vous n'avez pas validé.`,
        base ? `[Traiter les demandes](${base}/agents/demandes)` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    await audit("AVIS_DEMANDES_ENVOYE", { details: `${enAttente} en attente` });
  } catch {
    // Le battement suivant réessaiera.
  }
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
