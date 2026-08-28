import type { InscriptionStatut } from "@prisma/client";
import { prisma } from "./db";
import { getGeneralSettings } from "./settings";
import { audit } from "./audit";
import { isoDate } from "./dates";
import { adresseDeContact } from "./comptes";
import { prenomDe } from "./constants";
import { envoyerMail } from "./mail";

/**
 * Règles d'inscription.
 *
 * Un créneau a une capacité : au-delà, les demandes basculent en liste
 * d'attente plutôt que d'être refusées. Chaque désistement ou refus promeut
 * automatiquement le premier de la file — c'est ce qui évite au service des
 * sports de tenir une liste parallèle dans un tableur.
 *
 * Ces places se comptent sur le créneau, sauf si l'activité mutualise sa
 * capacité : voir `perimetreCapacite`.
 */

export type Resultat = { ok: boolean; message: string };

/**
 * Vrai si l'inscription fait participer l'agent à une séance de cette date.
 *
 * On rejoint une activité à partir du jour de son inscription, pas depuis le
 * début de la saison : les séances antérieures ne concernent pas l'agent — ni
 * sur la feuille d'émargement, ni dans ses statistiques d'assiduité.
 */
export function participeALaSeance(
  inscription: { decisionAt: Date | null; demandeAt: Date },
  dateSeance: Date,
): boolean {
  const debut = inscription.decisionAt ?? inscription.demandeAt;
  return isoDate(debut) <= isoDate(dateSeance);
}

/**
 * Périmètre sur lequel se comptent les places d'un créneau.
 *
 * Deux modèles coexistent, choisis activité par activité :
 *
 *  • capacité par créneau (défaut) — le lundi et le jeudi sont deux groupes
 *    distincts, chacun dimensionné pour sa salle et sa file d'attente ;
 *  • capacité mutualisée — l'activité n'a qu'un groupe, réparti sur plusieurs
 *    créneaux. La musculation prend 10 agents, qui viennent le lundi, le jeudi
 *    ou les deux. La place appartient alors à l'agent : suivre deux séances
 *    n'en consomme qu'une, et la file d'attente est commune à l'activité.
 */
export type Perimetre = {
  partagee: boolean;
  activiteId: string;
  capacite: number;
  creneauIds: string[]; // créneaux qui se partagent ces places
};

export async function perimetreCapacite(creneauId: string): Promise<Perimetre | null> {
  const creneau = await prisma.creneau.findUnique({
    where: { id: creneauId },
    select: {
      id: true,
      capacite: true,
      saisonId: true,
      activiteId: true,
      activite: { select: { capacitePartagee: true, capacite: true } },
    },
  });
  if (!creneau) return null;

  if (!creneau.activite.capacitePartagee) {
    return {
      partagee: false,
      activiteId: creneau.activiteId,
      capacite: creneau.capacite,
      creneauIds: [creneau.id],
    };
  }

  // Le groupe ne se partage qu'entre créneaux d'une même saison : deux saisons
  // successives ont chacune leurs inscrits.
  const fratrie = await prisma.creneau.findMany({
    where: { activiteId: creneau.activiteId, saisonId: creneau.saisonId },
    select: { id: true },
  });
  return {
    partagee: true,
    activiteId: creneau.activiteId,
    // La capacité est exigée dès que l'option est activée ; le repli sur celle
    // du créneau ne couvre qu'une activité configurée hors de l'application.
    capacite: creneau.activite.capacite ?? creneau.capacite,
    creneauIds: fratrie.map((c) => c.id),
  };
}

async function occupeesSur(p: Perimetre): Promise<number> {
  if (!p.partagee) {
    return prisma.inscription.count({
      where: { creneauId: p.creneauIds[0], statut: "VALIDEE" },
    });
  }
  // Capacité mutualisée : on compte des agents, pas des inscriptions. Celui qui
  // suit le lundi et le jeudi n'occupe qu'une place du groupe.
  const inscrits = await prisma.inscription.findMany({
    where: { creneauId: { in: p.creneauIds }, statut: "VALIDEE" },
    select: { userId: true },
    distinct: ["userId"],
  });
  return inscrits.length;
}

/** Vrai si l'agent occupe déjà une place du groupe (capacité mutualisée). */
async function detientUnePlace(p: Perimetre, userId: string): Promise<boolean> {
  const place = await prisma.inscription.findFirst({
    where: { userId, statut: "VALIDEE", creneauId: { in: p.creneauIds } },
    select: { id: true },
  });
  return place !== null;
}

export async function placesOccupees(creneauId: string): Promise<number> {
  const p = await perimetreCapacite(creneauId);
  return p ? occupeesSur(p) : 0;
}

export async function placesRestantes(creneauId: string): Promise<number> {
  const p = await perimetreCapacite(creneauId);
  if (!p) return 0;
  return Math.max(0, p.capacite - (await occupeesSur(p)));
}

/**
 * Vrai si l'agent peut être inscrit sur ce créneau sans dépasser la capacité.
 *
 * Distinct de `placesRestantes` : en capacité mutualisée, l'agent qui détient
 * déjà une place sur l'activité peut ajouter un second créneau même si le
 * groupe est complet — il n'en reprend pas une seconde.
 */
export async function placeDisponiblePour(
  creneauId: string,
  userId: string,
): Promise<boolean> {
  const p = await perimetreCapacite(creneauId);
  if (!p) return false;
  if (p.partagee && (await detientUnePlace(p, userId))) return true;
  return p.capacite - (await occupeesSur(p)) > 0;
}

/** Rang suivant dans la file d'attente — commune à l'activité si mutualisée. */
export async function prochainRang(creneauId: string): Promise<number> {
  const p = await perimetreCapacite(creneauId);
  if (!p) return 1;
  const dernier = await prisma.inscription.findFirst({
    where: { creneauId: { in: p.creneauIds }, statut: "LISTE_ATTENTE" },
    orderBy: { rang: "desc" },
    select: { rang: true },
  });
  return (dernier?.rang ?? 0) + 1;
}

/**
 * Effectif par activité sur une saison : nombre d'agents distincts inscrits,
 * tous créneaux confondus. Sert à afficher le remplissage d'un groupe mutualisé
 * sans recompter créneau par créneau à chaque ligne d'écran.
 */
export async function effectifsParActivite(saisonId: string): Promise<Map<string, number>> {
  const inscrits = await prisma.inscription.findMany({
    where: { statut: "VALIDEE", creneau: { saisonId } },
    select: { userId: true, creneau: { select: { activiteId: true } } },
  });
  const agents = new Map<string, Set<string>>();
  for (const i of inscrits) {
    const cle = i.creneau.activiteId;
    if (!agents.has(cle)) agents.set(cle, new Set());
    agents.get(cle)!.add(i.userId);
  }
  return new Map([...agents].map(([id, s]) => [id, s.size]));
}

/**
 * Demande d'inscription d'un agent.
 * Statut résultant : VALIDEE (si le service n'arbitre pas et qu'il reste de la
 * place), EN_ATTENTE (arbitrage) ou LISTE_ATTENTE (créneau complet).
 */

/** Qui est à l'origine de l'inscription — le texte du message en dépend. */
export type Origine = "agent" | "service";

/**
 * Accusé de réception envoyé à l'agent, à l'adresse que le service des sports
 * a saisie pour lui quand elle existe (`adresseDeContact`, src/lib/comptes.ts).
 *
 * Il manquait, et son absence était trompeuse plutôt que gênante :
 * l'application n'écrivait qu'au moment de l'arbitrage — donc jamais, quand la
 * validation automatique est active. L'agent voyait un message à l'écran,
 * refermait l'onglet, et n'avait plus aucune trace de sa demande : ni
 * confirmation, ni rang en liste d'attente, ni de quoi savoir s'il devait
 * relancer. Beaucoup en concluaient que « ça n'avait pas marché », et
 * recommençaient — d'où les doublons que le service devait ensuite démêler.
 *
 * Le texte dépend de deux choses : ce qui s'est réellement passé (inscription
 * validée, demande en attente d'arbitrage, place en liste d'attente) et qui en
 * est à l'origine. Un agent qu'on inscrit sans qu'il ait rien demandé doit
 * l'apprendre autrement qu'en lisant « votre demande a bien été enregistrée » :
 * il n'a rien demandé, et c'est précisément ce qu'il faut lui dire.
 *
 * Silencieux : une messagerie en panne ne doit pas faire échouer une
 * inscription qui, elle, est bien enregistrée.
 */
export async function accuserReception(
  userId: string,
  creneauId: string,
  statut: InscriptionStatut,
  rang: number | null,
  origine: Origine,
): Promise<void> {
  try {
    const [user, creneau] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true, email: true, emailContact: true },
      }),
      prisma.creneau.findUnique({
        where: { id: creneauId },
        select: {
          jour: true,
          heureDebut: true,
          heureFin: true,
          lieu: true,
          activite: { select: { nom: true } },
        },
      }),
    ]);
    if (!user || !creneau) return;
    const adresse = adresseDeContact(user);
    if (!adresse) return;

    const g = await getGeneralSettings();
    const quand = `${creneau.jour.toLowerCase()} de ${creneau.heureDebut} à ${creneau.heureFin}${creneau.lieu ? ` — ${creneau.lieu}` : ""}`;
    const nom = creneau.activite.nom;
    const seDesinscrire = `Si cette inscription ne vous convient pas, désinscrivez-vous depuis l'application : votre place profitera à un collègue en liste d'attente.`;

    const textes: Record<
      Origine,
      Partial<Record<InscriptionStatut, { objet: string; corps: string[] }>>
    > = {
      agent: {
        VALIDEE: {
          objet: `Inscription confirmée — ${nom}`,
          corps: [
            `Votre inscription à ${nom} est confirmée : ${quand}.`,
            `Un empêchement, ou vous souhaitez vous désinscrire ? Faites-le depuis l'application, votre place profitera à un collègue en liste d'attente.`,
          ],
        },
        EN_ATTENTE: {
          objet: `Demande d'inscription reçue — ${nom}`,
          corps: [
            `Votre demande d'inscription à ${nom} (${quand}) est bien enregistrée.`,
            `Le service des sports l'examine : vous recevrez un message dès qu'une décision sera prise. Vous n'avez rien d'autre à faire d'ici là.`,
          ],
        },
        LISTE_ATTENTE: {
          objet: `Liste d'attente — ${nom}`,
          corps: [
            `Le créneau de ${nom} (${quand}) est complet : vous êtes en liste d'attente${rang ? `, en position ${rang}` : ""}.`,
            `Vous serez prévenu par courriel dès qu'une place se libère. Votre demande reste valable, il est inutile de la renouveler.`,
          ],
        },
      },
      service: {
        VALIDEE: {
          objet: `Vous êtes inscrit — ${nom}`,
          corps: [
            `Le service des sports vous a inscrit à ${nom} : ${quand}.`,
            seDesinscrire,
          ],
        },
        LISTE_ATTENTE: {
          objet: `Liste d'attente — ${nom}`,
          corps: [
            `Le service des sports a enregistré votre inscription à ${nom} (${quand}), mais le créneau est complet : vous êtes en liste d'attente${rang ? `, en position ${rang}` : ""}.`,
            `Vous serez prévenu dès qu'une place se libère.`,
          ],
        },
      },
    };

    // REFUSEE et DESISTEE ont leur propre message, envoyé ailleurs. Une
    // inscription mise en attente par un animateur ne déclenche rien non plus :
    // c'est l'arbitrage du service qui écrira, et l'agent n'aurait pas compris
    // un courriel annonçant une demande qu'il n'a pas faite.
    const contenu = textes[origine][statut];
    if (!contenu) return;

    await envoyerMail(
      adresse,
      contenu.objet,
      [
        `Bonjour ${prenomDe(user.displayName)},`,
        ...contenu.corps,
        g.contactEmail ? `Le service des sports — ${g.contactEmail}` : `Le service des sports`,
      ].join("\n\n"),
    );
  } catch {
    // l'inscription est enregistrée : un courriel manqué ne doit rien annuler
  }
}

export type Acceptation = {
  /** Version des textes affichés à l'agent (src/lib/declarations.ts). */
  version: string;
  /** Consentement RGPD, coché à part des cinq déclarations. */
  rgpdAccepte: boolean;
};

export async function demanderInscription(
  userId: string,
  creneauId: string,
  commentaire?: string,
  acceptation?: Acceptation,
): Promise<Resultat> {
  const creneau = await prisma.creneau.findUnique({
    where: { id: creneauId },
    include: { activite: true, saison: true },
  });
  if (!creneau) return { ok: false, message: "Créneau introuvable." };
  if (!creneau.ouvertInscription) {
    return { ok: false, message: "Les inscriptions sont fermées sur ce créneau." };
  }
  if (!creneau.saison.active) {
    return { ok: false, message: "Ce créneau n'appartient pas à la saison en cours." };
  }

  const existante = await prisma.inscription.findUnique({
    where: { creneauId_userId: { creneauId, userId } },
  });
  if (existante && !["DESISTEE", "REFUSEE"].includes(existante.statut)) {
    return { ok: false, message: "Vous avez déjà une demande sur ce créneau." };
  }

  const g = await getGeneralSettings();
  if (g.maxInscriptionsParAgent > 0) {
    // Le quota porte sur les activités, pas sur les créneaux : suivre la
    // musculation deux fois par semaine reste une seule activité pratiquée.
    const engagements = await prisma.inscription.findMany({
      where: {
        userId,
        statut: { in: ["VALIDEE", "EN_ATTENTE", "LISTE_ATTENTE"] },
        creneau: { saisonId: creneau.saisonId },
        ...(existante ? { NOT: { id: existante.id } } : {}),
      },
      select: { creneau: { select: { activiteId: true } } },
    });
    const activites = new Set(engagements.map((e) => e.creneau.activiteId));
    if (!activites.has(creneau.activiteId) && activites.size >= g.maxInscriptionsParAgent) {
      return {
        ok: false,
        message: `Vous êtes limité à ${g.maxInscriptionsParAgent} activité${g.maxInscriptionsParAgent > 1 ? "s" : ""} par saison. Désinscrivez-vous d'une activité pour en choisir une autre.`,
      };
    }
  }

  const complet = !(await placeDisponiblePour(creneauId, userId));
  let statut: InscriptionStatut;
  if (complet) statut = "LISTE_ATTENTE";
  else if (g.validationRequise) statut = "EN_ATTENTE";
  else statut = "VALIDEE";

  const rang = statut === "LISTE_ATTENTE" ? await prochainRang(creneauId) : null;
  const data = {
    statut,
    rang,
    commentaire: commentaire?.trim() || null,
    demandeAt: new Date(),
    decisionAt: statut === "VALIDEE" ? new Date() : null,
    decidePar: statut === "VALIDEE" ? "automatique" : null,
    motif: null,
    // Archivé seulement quand l'agent a réellement coché à l'écran. Une
    // inscription saisie par le service des sports laisse ces colonnes nulles :
    // la fiche papier signée reste alors la preuve, et un NULL ne doit jamais
    // pouvoir se lire comme une acceptation supposée.
    ...(acceptation
      ? {
          declarationsAt: new Date(),
          declarationsVersion: acceptation.version,
          consentementRgpdAt: acceptation.rgpdAccepte ? new Date() : null,
        }
      : {}),
  };

  if (existante) {
    await prisma.inscription.update({ where: { id: existante.id }, data });
  } else {
    await prisma.inscription.create({ data: { creneauId, userId, ...data } });
  }

  await audit("INSCRIPTION_DEMANDE", {
    userId,
    cible: `${creneau.activite.nom} ${creneau.jour} ${creneau.heureDebut}`,
    details: statut,
  });

  await accuserReception(userId, creneauId, statut, rang, "agent");

  const messages: Record<InscriptionStatut, string> = {
    VALIDEE: `Inscription confirmée pour ${creneau.activite.nom}.`,
    EN_ATTENTE: `Demande envoyée au service des sports pour ${creneau.activite.nom}.`,
    LISTE_ATTENTE: `Créneau complet : vous êtes en liste d'attente (position ${rang}).`,
    REFUSEE: "",
    DESISTEE: "",
  };
  return { ok: true, message: messages[statut] };
}

export type InscriptionDirecte =
  | { deja: true }
  | { deja: false; statut: InscriptionStatut; rang: number | null };

/**
 * Positionne un agent sur un créneau sans qu'il en ait fait la demande :
 * inscription au guichet, dossier papier, ou agent venu à une séance.
 *
 * `decidePar` non nul = le service des sports décide lui-même, l'inscription
 * est validée d'emblée (ou mise en file si le créneau est plein). Nul = c'est
 * un animateur qui signale : il n'arbitre pas, la demande part en attente et
 * apparaît sur le tableau de bord du service des sports.
 */
export async function inscrireDirectement(
  creneauId: string,
  userId: string,
  decidePar: string | null,
  commentaire?: string,
): Promise<InscriptionDirecte> {
  const existante = await prisma.inscription.findUnique({
    where: { creneauId_userId: { creneauId, userId } },
  });
  if (existante && ["VALIDEE", "EN_ATTENTE", "LISTE_ATTENTE"].includes(existante.statut)) {
    return { deja: true };
  }

  let statut: InscriptionStatut = "EN_ATTENTE";
  let rang: number | null = null;
  if (decidePar) {
    if (await placeDisponiblePour(creneauId, userId)) statut = "VALIDEE";
    else {
      statut = "LISTE_ATTENTE";
      rang = await prochainRang(creneauId);
    }
  }

  const data = {
    statut,
    rang,
    demandeAt: new Date(),
    decisionAt: decidePar ? new Date() : null,
    decidePar,
    motif: null,
    commentaire: commentaire ?? null,
  };
  if (existante) {
    await prisma.inscription.update({ where: { id: existante.id }, data });
  } else {
    await prisma.inscription.create({ data: { creneauId, userId, ...data } });
  }

  // Prévenir l'agent, mais seulement quand la décision est prise : `decidePar`
  // nul, c'est un animateur qui signale une venue, la demande part en attente
  // et c'est l'arbitrage du service qui écrira. Sans cette réserve, l'agent
  // recevrait deux courriels pour une inscription qu'il n'a pas demandée.
  if (decidePar) await accuserReception(userId, creneauId, statut, rang, "service");

  return { deja: false, statut, rang };
}

/**
 * Promeut le premier de la liste d'attente quand une place se libère.
 * Renvoie l'inscription promue, ou null si la file est vide ou le créneau plein.
 *
 * En capacité mutualisée, la file est commune à l'activité : le désistement du
 * lundi peut donc profiter à quelqu'un qui attendait le jeudi. À l'inverse, un
 * agent qui quitte un créneau mais garde l'autre ne libère aucune place — sa
 * place étant comptée une seule fois, l'effectif ne bouge pas et personne n'est
 * promu à tort.
 */
export async function promouvoirListeAttente(creneauId: string) {
  const p = await perimetreCapacite(creneauId);
  if (!p) return null;
  if (p.capacite - (await occupeesSur(p)) <= 0) return null;

  const suivant = await prisma.inscription.findFirst({
    where: { creneauId: { in: p.creneauIds }, statut: "LISTE_ATTENTE" },
    orderBy: [{ rang: "asc" }, { demandeAt: "asc" }],
    include: { user: true, creneau: { include: { activite: true } } },
  });
  if (!suivant) return null;

  await prisma.inscription.update({
    where: { id: suivant.id },
    data: {
      statut: "VALIDEE",
      rang: null,
      decisionAt: new Date(),
      decidePar: "liste d'attente",
    },
  });

  // Le promu détient désormais une place du groupe : ses autres attentes sur la
  // même activité ne coûtent plus rien et n'ont pas à rester dans la file.
  if (p.partagee) {
    await prisma.inscription.updateMany({
      where: {
        userId: suivant.userId,
        statut: "LISTE_ATTENTE",
        creneauId: { in: p.creneauIds },
      },
      data: {
        statut: "VALIDEE",
        rang: null,
        decisionAt: new Date(),
        decidePar: "liste d'attente",
      },
    });
  }

  // Le promu laisse un trou dans la file : on resserre les positions pour que
  // « vous êtes n° 3 » reste vrai côté agent.
  await renumeroterFile(creneauId);
  await audit("INSCRIPTION_PROMUE", {
    userId: suivant.userId,
    cible: suivant.creneau.activite.nom,
  });
  return suivant;
}

/**
 * Promeut le premier de la file après une décision qui a pu libérer une place,
 * et le prévient. Renvoie le fragment de message à ajouter au compte rendu.
 *
 * `promouvoirListeAttente` est seul juge de l'existence d'une place : appeler
 * cette fonction sur une décision qui n'en libère aucune ne fait rien.
 *
 * Ici plutôt que dans les actions serveur, parce que les départs de comptes
 * (src/lib/departs.ts) libèrent des places exactement comme un désistement, et
 * doivent prévenir le suivant avec les mêmes mots. Un export depuis un module
 * « use server » en aurait fait un point d'entrée appelable depuis le
 * navigateur — ce qui n'a aucun sens pour une fonction interne.
 */
export async function promouvoirEtPrevenir(creneauId: string): Promise<string> {
  const promu = await promouvoirListeAttente(creneauId);
  if (!promu) return "";

  const adresse = adresseDeContact(promu.user);
  if (adresse) {
    const g = await getGeneralSettings();
    await envoyerMail(
      adresse,
      `Une place s'est libérée en ${promu.creneau.activite.nom}`,
      [
        `Bonjour ${prenomDe(promu.user.displayName)},`,
        `Une place vient de se libérer sur le créneau de ${promu.creneau.activite.nom} (${promu.creneau.jour.toLowerCase()} ${promu.creneau.heureDebut}). Votre inscription est confirmée.`,
        g.contactEmail
          ? `Si vous ne souhaitez plus participer, prévenez le service des sports : ${g.contactEmail}.`
          : `Si vous ne souhaitez plus participer, prévenez le service des sports.`,
      ].join("\n\n"),
    );
  }
  return ` ${promu.user.displayName} a été inscrit depuis la liste d'attente.`;
}

/** Renumérote la file après un départ, pour que les positions restent lisibles. */
export async function renumeroterFile(creneauId: string): Promise<void> {
  const p = await perimetreCapacite(creneauId);
  if (!p) return;
  const file = await prisma.inscription.findMany({
    where: { creneauId: { in: p.creneauIds }, statut: "LISTE_ATTENTE" },
    orderBy: [{ rang: "asc" }, { demandeAt: "asc" }],
    select: { id: true },
  });
  await Promise.all(
    file.map((i, idx) =>
      prisma.inscription.update({ where: { id: i.id }, data: { rang: idx + 1 } }),
    ),
  );
}
