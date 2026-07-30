"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { InscriptionStatut } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  chercherComptes,
  creerParticipantHorsAnnuaire,
  estCreeALaMain,
  estHorsAnnuaire,
  type Candidat,
} from "@/lib/comptes";
import { inscrireDirectement } from "@/lib/inscriptions";
import { desactiverCompte } from "@/lib/departs";
import { requireUser } from "@/lib/session";
import { erreur, succes, type ActionState } from "./types";
import { getLdapSettings } from "@/lib/settings";
import { ldapSearchAccounts } from "@/lib/ldap";

/**
 * Recherche d'agents pour les inscriptions.
 *
 * Trois sources, par ordre de fiabilité décroissante :
 *  1. les comptes Bolt existants (l'agent s'est déjà connecté) ;
 *  2. le miroir de l'annuaire, alimenté par la synchronisation ;
 *  3. l'annuaire en direct, si un compte de service est configuré.
 *
 * Sans la 2 et la 3, la liste serait vide à la rentrée : personne ne s'est
 * encore connecté, et c'est précisément le moment où le service des sports
 * saisit les inscriptions.
 */

export type Suggestion = {
  id: string;
  nom: string;
  login: string;
  detail: string | null; // service, à défaut direction
  inscriptions: number;
};

/**
 * Suggestions de la barre de recherche du tableau de bord.
 *
 * Ne porte que sur les comptes Bolt, comme la page /agents vers laquelle elle
 * mène : on cherche ici quelqu'un dont on veut consulter les inscriptions et
 * l'assiduité, ce qui suppose qu'il en ait. Inscrire un agent inconnu passe par
 * la recherche annuaire de la page des inscriptions.
 */
export async function suggererAgents(query: string): Promise<Suggestion[]> {
  await requireUser("GESTIONNAIRE");
  const q = query.trim();
  if (q.length < 2) return [];

  const agents = await prisma.user.findMany({
    where: {
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { login: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { service: { contains: q, mode: "insensitive" } },
        { direction: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { displayName: "asc" },
    take: 8,
    select: {
      id: true,
      displayName: true,
      login: true,
      service: true,
      direction: true,
      _count: { select: { inscriptions: { where: { statut: "VALIDEE" } } } },
    },
  });

  return agents.map((a) => ({
    id: a.id,
    nom: a.displayName,
    login: a.login,
    detail: a.service ?? a.direction,
    inscriptions: a._count.inscriptions,
  }));
}

// Pas de ré-export du type `Candidat` ici : dans un module « use server », le
// transformeur des actions n'efface pas `export type { … }` et produit une
// référence à un symbole qui n'existe qu'à la compilation. Les consommateurs
// importent le type depuis @/lib/comptes, où il est défini.

export async function rechercherAgents(query: string): Promise<Candidat[]> {
  await requireUser("GESTIONNAIRE");
  const q = query.trim();
  if (q.length < 2) return [];

  const trouves = new Map<string, Candidat>();

  const comptes = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["AGENT", "GESTIONNAIRE", "COACH"] },
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { login: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { displayName: "asc" },
    take: 15,
  });
  for (const u of comptes) {
    trouves.set(u.login.toLowerCase(), {
      login: u.login.toLowerCase(),
      nom: u.displayName,
      email: u.email,
      service: u.service,
      direction: u.direction,
      source: "compte",
    });
  }

  const miroir = await prisma.adAccount.findMany({
    where: {
      enabled: true,
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { samAccountName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { displayName: "asc" },
    take: 15,
  });
  for (const a of miroir) {
    const cle = a.samAccountName.toLowerCase();
    if (trouves.has(cle)) continue;
    trouves.set(cle, {
      login: cle,
      nom: a.displayName ?? a.samAccountName,
      email: a.email,
      service: a.service,
      direction: a.direction,
      source: "annuaire",
    });
  }

  // Recherche à la volée : couvre les agents arrivés depuis la dernière
  // synchronisation. Best-effort — un annuaire injoignable ne doit pas casser
  // la recherche sur les deux premières sources.
  if (trouves.size < 10) {
    try {
      const ldap = await getLdapSettings();
      if (ldap?.bindDn && ldap?.bindPassword && ldap.enabled !== false) {
        for (const a of await ldapSearchAccounts(ldap, q, 10)) {
          const cle = a.samAccountName.toLowerCase();
          if (trouves.has(cle) || !a.enabled) continue;
          trouves.set(cle, {
            login: cle,
            nom: a.displayName ?? a.samAccountName,
            email: a.email ?? null,
            service: a.service ?? null,
            direction: a.direction ?? null,
            source: "annuaire",
          });
        }
      }
    } catch {
      // annuaire indisponible : on se contente des sources locales
    }
  }

  return [...trouves.values()]
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
    .slice(0, 20);
}

/**
 * Recherche restreinte aux agents déjà connus de Bolt — sans le miroir de
 * l'annuaire ni l'interrogation LDAP.
 *
 * Destinée aux animateurs, qui ajoutent un participant venu sans être inscrit.
 * Leur ouvrir l'annuaire entier reviendrait à exposer le répertoire de la
 * collectivité : un animateur est un intervenant extérieur, et la feuille
 * d'émargement est jointe depuis Internet. La contrepartie est assumée — un
 * agent qui n'a jamais été inscrit ni connecté n'apparaît pas, et c'est alors
 * au service des sports de l'ajouter.
 */
export async function rechercherAgentsConnus(query: string): Promise<Candidat[]> {
  await requireUser("GESTIONNAIRE", "COACH");
  return chercherComptes(query);
}

/**
 * Crée un participant qui n'existe pas dans l'Active Directory.
 *
 * Tout le monde n'a pas de compte AD : élus, agents d'un CCAS ou d'un syndicat
 * intercommunal, apprentis et stagiaires en attente d'ouverture de compte,
 * membres d'une association partenaire conviés aux séances. Sans cette porte,
 * ces participants n'existent nulle part — ni sur les feuilles, ni dans le
 * bilan de fréquentation, alors qu'ils occupent bien une place.
 *
 * L'identifiant est préfixé « no_ad. » : il ne peut donc jamais entrer en
 * collision avec un sAMAccountName si la personne obtient un compte AD plus
 * tard. Le compte n'a pas de mot de passe — la connexion, si elle est
 * nécessaire, passe par le lien envoyé sur l'adresse renseignée.
 *
 * La synchronisation de l'annuaire ne touche pas à ces comptes : elle ne
 * désactive jamais ce qu'elle n'y trouve pas.
 */
export async function creerAgentHorsAnnuaire(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("GESTIONNAIRE");
  const nom = String(formData.get("nom") ?? "").trim().replace(/\s+/g, " ");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const direction = String(formData.get("direction") ?? "").trim();
  const service = String(formData.get("service") ?? "").trim();
  const creneauId = String(formData.get("creneauId") ?? "");

  if (nom.length < 2) return erreur("Indiquez le nom et le prénom de la personne.");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return erreur("Adresse e-mail invalide.");
  }
  if (email) {
    const doublon = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { displayName: true },
    });
    if (doublon) {
      return erreur(
        `Cette adresse est déjà celle de ${doublon.displayName}. Cherchez-le plutôt dans la liste.`,
      );
    }
  }

  const user = await creerParticipantHorsAnnuaire({ nom, email, direction, service });

  let suite = "";
  if (creneauId) {
    const res = await inscrireDirectement(
      creneauId,
      user.id,
      admin.displayName,
      "Participant hors annuaire",
    );
    if (!res.deja) {
      suite =
        res.statut === "VALIDEE"
          ? " Inscrit au créneau."
          : ` Créneau complet : placé en liste d'attente (n°${res.rang}).`;
    }
  }

  await audit("AGENT_HORS_ANNUAIRE_CREE", {
    userId: admin.id,
    cible: nom,
    details: user.login,
  });
  revalidatePath("/inscriptions");
  revalidatePath("/agents");
  return succes(`${nom} créé (identifiant ${user.login}).${suite}`);
}

/**
 * Enregistre l'adresse à laquelle joindre un agent — n'importe quel agent.
 *
 * Écrite dans `emailContact` et non dans `email` : cette dernière appartient à
 * l'annuaire, qui la réécrit à chaque connexion LDAPS. Sans champ distinct, il
 * n'y avait aucun moyen de joindre un agent AD qui ne consulte pas sa boîte
 * professionnelle — terrain, crèches, gardiennage —, soit exactement la
 * population pour laquelle la connexion par lien existe.
 *
 * C'est cette adresse qui décide de tout ce que Bolt envoie : lien de connexion,
 * rappels de séance, annonces d'annulation.
 */
export async function modifierEmailAgent(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("GESTIONNAIRE");
  const userId = String(formData.get("userId") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  const agent = await prisma.user.findUnique({ where: { id: userId } });
  if (!agent) return erreur("Agent introuvable.");

  // Réservé aux participants hors annuaire, et c'est une question de privilèges.
  //
  // L'adresse de contact prime sur celle de l'annuaire pour l'envoi du lien de
  // connexion (adresseDeContact, src/lib/comptes.ts). La poser sur le compte d'un
  // administrateur revenait à se faire adresser son lien et à ouvrir sa session :
  // un gestionnaire pouvait s'élever au rang d'administrateur sans connaître
  // aucun mot de passe.
  //
  // La permission se lit donc en liste blanche — les comptes « no_ad.… » — et non
  // en liste noire. Un compte d'annuaire tient son adresse de l'AD ; un compte
  // local, lui, a un mot de passe, et l'administrateur de secours en est un : le
  // filtrer sur la seule origine annuaire aurait laissé passer précisément la
  // cible la plus intéressante.
  if (!estHorsAnnuaire(agent.login)) {
    return erreur(
      "L'adresse d'un compte de l'annuaire vient de l'Active Directory : elle se corrige là-bas, pas ici.",
    );
  }
  // Ceinture et bretelles : un participant hors annuaire promu gestionnaire ou
  // administrateur ne doit pas rouvrir le même chemin.
  if (agent.role === "ADMIN" || agent.role === "GESTIONNAIRE") {
    return erreur(
      "Ce compte dispose de droits étendus : son adresse ne se modifie pas depuis cet écran.",
    );
  }

  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return erreur("Adresse e-mail invalide.");
  }
  if (email) {
    // Le lien de connexion se résout par l'adresse : deux agents qui la
    // partagent rendraient l'accès ambigu, et l'un ouvrirait la session de
    // l'autre. On cherche donc le doublon sur les deux champs.
    const doublon = await prisma.user.findFirst({
      where: {
        id: { not: agent.id },
        OR: [
          { email: { equals: email, mode: "insensitive" } },
          { emailContact: { equals: email, mode: "insensitive" } },
        ],
      },
      select: { displayName: true },
    });
    if (doublon) {
      return erreur(`Cette adresse est déjà celle de ${doublon.displayName}.`);
    }
  }

  await prisma.user.update({
    where: { id: agent.id },
    data: { emailContact: email || null },
  });
  await audit("AGENT_EMAIL_MODIFIE", {
    userId: admin.id,
    cible: agent.displayName,
    details: email || "adresse retirée",
  });
  revalidatePath(`/agents/${agent.id}`);
  return succes(email ? `Adresse enregistrée : ${email}.` : "Adresse retirée.");
}

/**
 * Identité d'un compte dans l'annuaire : le miroir d'abord, l'annuaire en
 * direct ensuite. Renvoie null si le sAMAccountName n'y figure pas.
 */
async function identiteAnnuaire(login: string) {
  const cle = login.trim().toLowerCase();
  const miroir = await prisma.adAccount.findFirst({
    where: { samAccountName: { equals: cle, mode: "insensitive" } },
  });
  if (miroir) {
    return {
      login: miroir.samAccountName.toLowerCase(),
      nom: miroir.displayName ?? miroir.samAccountName,
      email: miroir.email,
      service: miroir.service,
      direction: miroir.direction,
    };
  }
  try {
    const ldap = await getLdapSettings();
    if (ldap?.bindDn && ldap?.bindPassword) {
      const [trouve] = await ldapSearchAccounts(ldap, cle, 1);
      if (trouve && trouve.samAccountName.toLowerCase() === cle) {
        return {
          login: cle,
          nom: trouve.displayName ?? trouve.samAccountName,
          email: trouve.email ?? null,
          service: trouve.service ?? null,
          direction: trouve.direction ?? null,
        };
      }
    }
  } catch {
    // annuaire injoignable : un compte Bolt existant suffit à rattacher
  }
  return null;
}

/**
 * Départage deux inscriptions concurrentes lors d'une fusion : on garde la
 * plus engageante. Perdre une place validée au profit d'un refus serait le
 * pire des arbitrages automatiques.
 */
const FORCE_STATUT: Record<InscriptionStatut, number> = {
  VALIDEE: 4,
  LISTE_ATTENTE: 3,
  EN_ATTENTE: 2,
  DESISTEE: 1,
  REFUSEE: 0,
};

/**
 * Rattache un participant hors annuaire au compte Active Directory qu'il a
 * fini par obtenir — l'apprenti titularisé, le stagiaire dont le compte arrive
 * trois semaines après son arrivée.
 *
 * Deux situations, et c'est toute la difficulté. Si l'agent n'a jamais eu de
 * compte Bolt, on renomme simplement le sien : l'historique suit sans qu'une
 * seule ligne ne bouge. Si un compte existe déjà — parce qu'il s'est connecté,
 * ou qu'on l'a inscrit ailleurs sous son vrai identifiant — il faut fusionner
 * les deux fiches, en réglant les collisions : une même personne peut être
 * inscrite deux fois au même créneau, ou pointée deux fois à la même séance.
 *
 * Le compte de l'annuaire l'emporte toujours comme survivant : c'est son
 * identifiant que l'Active Directory présentera à la prochaine connexion.
 */
export async function rattacherCompteAd(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("GESTIONNAIRE");
  const userId = String(formData.get("userId") ?? "");
  const cible = String(formData.get("login") ?? "").trim().toLowerCase();

  const source = await prisma.user.findUnique({
    where: { id: userId },
    include: { coach: { select: { id: true } } },
  });
  if (!source) return erreur("Participant introuvable.");
  // Classement, pas permission : un participant créé sous l'ancien préfixe
  // « ext. » doit rester rattachable à son compte d'annuaire.
  if (!estCreeALaMain(source.login)) {
    return erreur("Ce compte vient déjà de l'annuaire : il n'y a rien à rattacher.");
  }
  if (!cible) return erreur("Sélectionnez le compte Active Directory correspondant.");
  if (estCreeALaMain(cible)) {
    return erreur(
      "Choisissez un compte de l'annuaire, pas un autre participant hors annuaire.",
    );
  }

  const [existant, identite] = await Promise.all([
    prisma.user.findUnique({
      where: { login: cible },
      include: { coach: { select: { id: true } } },
    }),
    identiteAnnuaire(cible),
  ]);
  if (!existant && !identite) {
    return erreur(
      "Ce compte est introuvable dans l'annuaire. Synchronisez l'annuaire, ou vérifiez l'identifiant.",
    );
  }

  // ── Cas simple : aucun compte Bolt en face, on renomme ───────────────────
  if (!existant) {
    const ad = identite!;
    await prisma.user.update({
      where: { id: source.id },
      data: {
        login: ad.login,
        displayName: ad.nom || source.displayName,
        email: ad.email ?? source.email,
        service: ad.service ?? source.service,
        direction: ad.direction ?? source.direction,
        // Le compte devient un compte d'annuaire : son adresse est désormais
        // celle de l'AD. Conserver l'adresse de contact laisserait une valeur
        // qui prime sur l'annuaire et que plus aucun écran ne peut corriger.
        emailContact: null,
      },
    });
    await audit("AGENT_RATTACHE_AD", {
      userId: admin.id,
      cible: source.displayName,
      details: `${source.login} → ${ad.login} (renommage, historique conservé)`,
    });
    revalidatePath(`/agents/${source.id}`);
    revalidatePath("/agents");
    return succes(
      `Rattaché au compte ${ad.login}. Son historique le suit, et il retrouvera ses inscriptions à sa prochaine connexion.`,
    );
  }

  // ── Cas fusion : deux fiches pour une même personne ──────────────────────
  if (source.coach && existant.coach) {
    return erreur(
      "Les deux comptes sont rattachés à un animateur. Détachez-en un avant de fusionner.",
    );
  }

  const bilan = { inscriptions: 0, presences: 0, absences: 0, doublons: 0 };

  await prisma.$transaction(async (tx) => {
    // Inscriptions : une par créneau et par agent. En cas de collision, la
    // plus engageante l'emporte, à égalité la plus ancienne.
    const [insSource, insCible] = await Promise.all([
      tx.inscription.findMany({ where: { userId: source.id } }),
      tx.inscription.findMany({ where: { userId: existant.id } }),
    ]);
    const parCreneau = new Map(insCible.map((i) => [i.creneauId, i]));
    for (const i of insSource) {
      const rivale = parCreneau.get(i.creneauId);
      if (!rivale) {
        await tx.inscription.update({ where: { id: i.id }, data: { userId: existant.id } });
        bilan.inscriptions += 1;
        continue;
      }
      bilan.doublons += 1;
      const gardeSource =
        FORCE_STATUT[i.statut] > FORCE_STATUT[rivale.statut] ||
        (FORCE_STATUT[i.statut] === FORCE_STATUT[rivale.statut] &&
          i.demandeAt < rivale.demandeAt);
      if (gardeSource) {
        await tx.inscription.delete({ where: { id: rivale.id } });
        await tx.inscription.update({ where: { id: i.id }, data: { userId: existant.id } });
        bilan.inscriptions += 1;
      } else {
        await tx.inscription.delete({ where: { id: i.id } });
      }
    }

    // Présences : un même fait ne se compte qu'une fois. En cas de doublon on
    // garde le pointage le plus récent — c'est la dernière correction.
    const [prSource, prCible] = await Promise.all([
      tx.presence.findMany({ where: { userId: source.id } }),
      tx.presence.findMany({ where: { userId: existant.id } }),
    ]);
    const parSeance = new Map(prCible.map((p) => [p.seanceId, p]));
    for (const p of prSource) {
      const rivale = parSeance.get(p.seanceId);
      if (!rivale) {
        await tx.presence.update({ where: { id: p.id }, data: { userId: existant.id } });
        bilan.presences += 1;
        continue;
      }
      bilan.doublons += 1;
      if (p.saisiAt > rivale.saisiAt) {
        await tx.presence.delete({ where: { id: rivale.id } });
        await tx.presence.update({ where: { id: p.id }, data: { userId: existant.id } });
        bilan.presences += 1;
      } else {
        await tx.presence.delete({ where: { id: p.id } });
      }
    }

    const absSource = await tx.absenceAnnoncee.findMany({ where: { userId: source.id } });
    const absCible = new Set(
      (
        await tx.absenceAnnoncee.findMany({
          where: { userId: existant.id },
          select: { seanceId: true },
        })
      ).map((a) => a.seanceId),
    );
    for (const a of absSource) {
      if (absCible.has(a.seanceId)) {
        await tx.absenceAnnoncee.delete({ where: { id: a.id } });
        bilan.doublons += 1;
      } else {
        await tx.absenceAnnoncee.update({ where: { id: a.id }, data: { userId: existant.id } });
        bilan.absences += 1;
      }
    }

    // Le journal suit la personne : sans cela, la suppression du compte
    // source dénouerait ses entrées et l'on perdrait la trace de qui a agi.
    await tx.auditLog.updateMany({
      where: { userId: source.id },
      data: { userId: existant.id },
    });
    if (source.coach) {
      await tx.coach.update({
        where: { id: source.coach.id },
        data: { userId: existant.id },
      });
    }

    // Ce que le compte hors annuaire savait et que l'annuaire ignore : on ne
    // le jette pas, on ne l'impose pas non plus à ce qui vient de l'AD.
    await tx.user.update({
      where: { id: existant.id },
      data: {
        email: existant.email ?? source.email,
        service: existant.service ?? source.service,
        direction: existant.direction ?? source.direction,
      },
    });

    await tx.user.delete({ where: { id: source.id } });
  });

  await audit("AGENT_FUSIONNE_AD", {
    userId: admin.id,
    cible: existant.displayName,
    details: `${source.login} fusionné dans ${existant.login} — ${bilan.inscriptions} inscription(s), ${bilan.presences} présence(s), ${bilan.absences} absence(s), ${bilan.doublons} doublon(s) écarté(s)`,
  });
  revalidatePath("/agents");
  revalidatePath("/inscriptions");
  redirect(`/agents/${existant.id}?fusion=1`);
}

/**
 * Recherche restreinte aux comptes issus de l'annuaire.
 *
 * Sert au rattachement : proposer un autre participant hors annuaire comme
 * cible n'aurait aucun sens — on cherche précisément un vrai sAMAccountName.
 */
export async function rechercherComptesAd(query: string): Promise<Candidat[]> {
  await requireUser("GESTIONNAIRE");
  return (await rechercherAgents(query)).filter((c) => !estCreeALaMain(c.login));
}

/**
 * Garantit l'existence du compte applicatif d'un agent, à partir de son
 * identifiant d'annuaire. Le compte créé ici n'a pas de mot de passe : l'agent
 * se connectera en LDAPS et récupérera ses inscriptions.
 */
export async function assurerCompteAgent(login: string): Promise<string | null> {
  const cle = login.trim().toLowerCase();
  if (!cle) return null;

  const existant = await prisma.user.findUnique({ where: { login: cle } });
  if (existant) return existant.id;

  let nom = cle;
  let email: string | null = null;
  let service: string | null = null;
  let direction: string | null = null;

  const miroir = await prisma.adAccount.findFirst({
    where: { samAccountName: { equals: cle, mode: "insensitive" } },
  });
  if (miroir) {
    nom = miroir.displayName ?? miroir.samAccountName;
    email = miroir.email;
    service = miroir.service;
    direction = miroir.direction;
  } else {
    try {
      const ldap = await getLdapSettings();
      if (ldap?.bindDn && ldap?.bindPassword) {
        const [trouve] = await ldapSearchAccounts(ldap, cle, 1);
        if (trouve) {
          nom = trouve.displayName ?? trouve.samAccountName;
          email = trouve.email ?? null;
          service = trouve.service ?? null;
          direction = trouve.direction ?? null;
          // On alimente le miroir au passage : la prochaine recherche sera locale.
          const { samAccountName, ...reste } = trouve;
          await prisma.adAccount.upsert({
            where: { samAccountName },
            update: { ...reste, syncedAt: new Date() },
            create: { samAccountName, ...reste, syncedAt: new Date() },
          });
        }
      }
    } catch {
      // on crée quand même le compte avec le seul identifiant
    }
  }

  const user = await prisma.user.create({
    data: { login: cle, displayName: nom, email, service, direction, role: "AGENT" },
  });
  return user.id;
}

/**
 * Départ d'un agent, depuis sa fiche : le service des sports ferme son accès et
 * choisit s'il le retire de ses activités.
 *
 * Le choix est proposé plutôt qu'imposé. Une absence longue — congé maternité,
 * disponibilité, arrêt prolongé — se gère parfois par une désactivation
 * temporaire, et faire perdre sa place à quelqu'un qui revient en septembre
 * serait une mauvaise surprise. Un vrai départ, à l'inverse, doit rendre la
 * place : elle profite immédiatement au premier de la liste d'attente.
 */
export async function desactiverAgent(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("GESTIONNAIRE");
  const userId = String(formData.get("userId") ?? "");
  if (userId === admin.id) {
    return erreur("Vous ne pouvez pas désactiver votre propre compte.");
  }

  const desinscrire = formData.get("desinscrire") === "on";
  const motif = String(formData.get("motif") ?? "").trim() || "départ de la collectivité";

  const res = await desactiverCompte(userId, {
    acteur: admin.displayName,
    desinscrire,
    motif,
  });
  if (!res.applique) return erreur("Agent introuvable.");

  revalidatePath(`/agents/${userId}`);
  revalidatePath("/agents");
  revalidatePath("/inscriptions");
  revalidatePath("/parametres/utilisateurs");

  const details = [
    `${res.nom} : accès fermé.`,
    res.inscriptionsRetirees > 0
      ? `${res.inscriptionsRetirees} inscription(s) retirée(s), places rendues.`
      : desinscrire
        ? "Aucune inscription à retirer."
        : "Ses inscriptions sont conservées.",
    ...res.promotions,
  ];
  return succes(details.join(" "));
}

/** Réouverture d'un accès. Les inscriptions retirées ne reviennent pas seules. */
export async function reactiverAgent(userId: string): Promise<void> {
  const admin = await requireUser("GESTIONNAIRE");
  const cible = await prisma.user.findUnique({ where: { id: userId } });
  if (!cible || cible.active) return;
  await prisma.user.update({ where: { id: userId }, data: { active: true } });
  await audit("COMPTE_ACTIVE", { userId: admin.id, cible: cible.login });
  revalidatePath(`/agents/${userId}`);
  revalidatePath("/agents");
}
