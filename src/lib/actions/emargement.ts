"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { EtatPresence } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  changerPin,
  coachAutorise,
  fermerSessionCoach,
  verifierPin,
} from "@/lib/coach-access";
import { rateLimit } from "@/lib/rate-limit";
import { aujourdhui, jourUtc } from "@/lib/dates";
import { enregistrerPresence, saisieOuverte } from "@/lib/emargement";
import { participeALaSeance } from "@/lib/inscriptions";
import { notifierSeanceRetablie, notifierSeancesAnnulees } from "@/lib/notifications";
import { clientIp } from "@/lib/net";
import {
  chercherComptes,
  creerParticipantHorsAnnuaire,
  type Candidat,
} from "@/lib/comptes";
import { erreur, succes, type ActionState } from "./types";

/**
 * Actions de la feuille d'émargement publique.
 *
 * Toutes vérifient d'abord `coachAutorise(token)` : le jeton présent dans
 * l'URL ne suffit jamais à écrire, la session PIN doit être ouverte. Et toutes
 * revérifient que la séance appartient bien à un créneau de cet animateur —
 * sans quoi un identifiant de séance deviné permettrait d'écrire ailleurs.
 */

const ETATS: EtatPresence[] = ["PRESENT", "ABSENT"];

export async function validerPinAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const pin = String(formData.get("pin") ?? "");
  const ip = clientIp(await headers());
  const res = await verifierPin(token, pin, ip);
  if (!res.ok) return erreur(res.message);
  redirect(`/emargement/${token}`);
}

/** L'animateur remplace le code reçu par un code qu'il retiendra. */
export async function changerPinAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const coach = await coachAutorise(token);
  if (!coach) return erreur("Session expirée. Ressaisissez votre code.");

  // Coupe-circuit : le formulaire n'est servi qu'à une session ouverte, mais
  // rien n'empêcherait d'y marteler des combinaisons pour deviner l'ancien code.
  const ip = clientIp(await headers());
  if (!rateLimit(`pin-change:${ip}`, 10, 600).ok) {
    return erreur("Trop de tentatives. Patientez quelques minutes.");
  }

  const res = await changerPin(
    coach.id,
    String(formData.get("ancien") ?? ""),
    String(formData.get("nouveau") ?? ""),
  );
  if (!res.ok) return erreur(res.message);
  revalidatePath(`/emargement/${token}`);
  return succes(res.message);
}

export async function quitterAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  await fermerSessionCoach();
  redirect(`/emargement/${token}`);
}

/** Vérifie que la séance relève bien de l'animateur porteur du jeton. */
async function seanceDuCoach(token: string, seanceId: string) {
  const coach = await coachAutorise(token);
  if (!coach) return null;
  const seance = await prisma.seance.findFirst({
    where: { id: seanceId, creneau: { animateurs: { some: { id: coach.id } } } },
    include: { creneau: { include: { activite: true } } },
  });
  if (!seance) return null;
  return { coach, seance };
}

export async function pointerEmargement(
  token: string,
  seanceId: string,
  userId: string,
  etat: string,
): Promise<void> {
  const ctx = await seanceDuCoach(token, seanceId);
  if (!ctx) return;
  const { coach, seance } = ctx;
  if (seance.clotureeAt) return;
  if (seance.statut === "ANNULEE") return;
  if (!saisieOuverte(seance.date)) return;
  if (!ETATS.includes(etat as EtatPresence)) return;

  // La feuille publique ne crée pas de ligne pour n'importe quel compte de la
  // collectivité : il faut être inscrit au créneau, **ou** figurer déjà sur la
  // feuille. Sans ce second cas, un participant ajouté à la volée était pointé
  // présent à sa création puis impossible à corriger — le bouton « absent »
  // restait sans effet.
  const [inscrit, dejaSurLaFeuille] = await Promise.all([
    prisma.inscription.findFirst({
      where: { creneauId: seance.creneauId, userId, statut: "VALIDEE" },
      select: { id: true },
    }),
    prisma.presence.findUnique({
      where: { seanceId_userId: { seanceId, userId } },
      select: { id: true },
    }),
  ]);
  if (!inscrit && !dejaSurLaFeuille) return;

  await enregistrerPresence(seanceId, userId, etat as EtatPresence, `coach:${coach.id}`);
  revalidatePath(`/emargement/${token}/${seanceId}`);
}

export async function cloturerEmargement(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const seanceId = String(formData.get("seanceId") ?? "");
  const ctx = await seanceDuCoach(token, seanceId);
  if (!ctx) return erreur("Séance introuvable.");
  const { coach, seance } = ctx;
  if (seance.clotureeAt) return succes("Feuille déjà transmise.");

  const pointes = await prisma.presence.count({ where: { seanceId } });
  if (pointes === 0) {
    return erreur("Pointez au moins un participant avant de transmettre la feuille.");
  }

  await prisma.seance.update({
    where: { id: seanceId },
    data: {
      clotureeAt: new Date(),
      clotureePar: `${coach.prenom} ${coach.nom}`,
      commentaire: String(formData.get("commentaire") ?? "").trim() || seance.commentaire,
    },
  });
  await audit("SEANCE_CLOTUREE", {
    acteur: `${coach.prenom} ${coach.nom}`,
    cible: `${seance.creneau.activite.nom} ${seance.date.toISOString().slice(0, 10)}`,
  });

  revalidatePath(`/emargement/${token}`);
  redirect(`/emargement/${token}?transmise=1`);
}

export async function annulerSeanceEmargement(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const seanceId = String(formData.get("seanceId") ?? "");
  const motif = String(formData.get("motif") ?? "").trim();
  if (!motif) return erreur("Indiquez pourquoi la séance n'a pas eu lieu.");

  const ctx = await seanceDuCoach(token, seanceId);
  if (!ctx) return erreur("Séance introuvable.");
  const { coach, seance } = ctx;
  if (seance.clotureeAt) return erreur("Feuille déjà transmise.");

  await prisma.seance.update({
    where: { id: seanceId },
    data: {
      statut: "ANNULEE",
      motifAnnulation: motif,
      clotureeAt: new Date(),
      clotureePar: `${coach.prenom} ${coach.nom}`,
    },
  });
  await audit("SEANCE_ANNULEE", {
    acteur: `${coach.prenom} ${coach.nom}`,
    cible: `${seance.creneau.activite.nom} ${seance.date.toISOString().slice(0, 10)}`,
    details: motif,
  });

  revalidatePath(`/emargement/${token}`);
  redirect(`/emargement/${token}?annulee=1`);
}

/**
 * Recherche d'un agent à ajouter à la feuille, pour l'animateur par lien.
 *
 * Restreinte aux agents déjà connus de Bolt, et amputée de ceux qui figurent
 * déjà sur la feuille : la page est jointe depuis Internet, il n'est pas
 * question d'en faire un annuaire de la collectivité.
 */
export async function rechercherParticipantEmargement(
  token: string,
  seanceId: string,
  query: string,
): Promise<Candidat[]> {
  const ctx = await seanceDuCoach(token, seanceId);
  if (!ctx) return [];

  const [presences, inscriptions] = await Promise.all([
    prisma.presence.findMany({ where: { seanceId }, select: { userId: true } }),
    prisma.inscription.findMany({
      where: { creneauId: ctx.seance.creneauId, statut: "VALIDEE" },
      select: { userId: true, decisionAt: true, demandeAt: true },
    }),
  ]);
  // Un inscrit postérieur à la séance n'est pas sur cette feuille : il doit
  // rester proposable à l'ajout, comme n'importe quel participant ponctuel.
  const dejaLa = [
    ...new Set(
      [
        ...presences,
        ...inscriptions.filter((i) => participeALaSeance(i, ctx.seance.date)),
      ].map((x) => x.userId),
    ),
  ];
  return chercherComptes(query, dejaLa);
}

/**
 * Services connus de la collectivité, pour situer un participant créé à la
 * volée. On expose la liste des services — pas l'annuaire nominatif : le
 * niveau organigramme suffit au service des sports pour identifier la
 * personne, sans faire de la feuille publique un répertoire d'agents.
 */
export async function listerServicesEmargement(
  token: string,
  seanceId: string,
): Promise<string[]> {
  const ctx = await seanceDuCoach(token, seanceId);
  if (!ctx) return [];

  const [comptes, annuaire] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, service: { not: null } },
      select: { service: true },
      distinct: ["service"],
    }),
    prisma.adAccount.findMany({
      where: { enabled: true, service: { not: null } },
      select: { service: true },
      distinct: ["service"],
    }),
  ]);
  return [...new Set([...comptes, ...annuaire].map((x) => x.service!).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "fr"))
    .slice(0, 200);
}

/**
 * Ajout d'un participant venu sans être inscrit, depuis la feuille mobile.
 *
 * Il est pointé présent — c'est le fait constaté — et l'animateur peut
 * proposer son inscription au créneau dans le même geste. Cette demande part
 * en attente : l'animateur signale, le service des sports arbitre.
 *
 * Si la personne est introuvable dans Bolt (élu, agent sans compte, membre
 * d'un organisme partenaire), l'animateur peut la créer par son nom
 * (`nomLibre`), en la situant au besoin par son service. Le compte créé est
 * un participant hors annuaire (identifiant « no_ad.… »), comme ceux que crée
 * le service des sports — qui en est informé par le journal.
 */
export async function ajouterParticipantEmargement(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const seanceId = String(formData.get("seanceId") ?? "");
  const login = String(formData.get("login") ?? "").trim();
  const nomLibre = String(formData.get("nomLibre") ?? "").trim().replace(/\s+/g, " ");
  if (!login && nomLibre.length < 2) return erreur("Sélectionnez un agent.");

  const ctx = await seanceDuCoach(token, seanceId);
  if (!ctx) return erreur("Séance introuvable.");
  const { coach, seance } = ctx;
  if (seance.clotureeAt) return erreur("Feuille déjà transmise.");
  if (seance.statut === "ANNULEE") return erreur("Cette séance est annulée.");
  // Même fenêtre que le pointage : ajouter quelqu'un, c'est le pointer présent,
  // et une présence ne se constate pas sur une séance qui n'a pas eu lieu.
  if (!saisieOuverte(seance.date)) {
    return erreur(
      seance.date > aujourdhui()
        ? "Cette séance n'a pas encore eu lieu : ajoutez le participant le jour même."
        : "La fenêtre de saisie de cette séance est passée : contactez le service des sports.",
    );
  }

  let agent;
  if (login) {
    agent = await prisma.user.findUnique({ where: { login: login.toLowerCase() } });
    if (!agent || !agent.active) return erreur("Agent introuvable.");
  } else {
    // Création à la volée depuis une page jointe sur Internet : le plafond
    // horaire borne ce qu'une session compromise pourrait injecter comme
    // comptes, sans gêner l'usage réel — quelques invités par séance au plus.
    if (!rateLimit(`hors-annuaire:${coach.id}`, 5, 3600).ok) {
      return erreur(
        "Trop de participants créés d'affilée. Réessayez plus tard, ou signalez-les au service des sports.",
      );
    }
    agent = await creerParticipantHorsAnnuaire({
      nom: nomLibre,
      service: String(formData.get("service") ?? "").trim() || null,
    });
    await audit("AGENT_HORS_ANNUAIRE_CREE", {
      acteur: `${coach.prenom} ${coach.nom}`,
      cible: nomLibre,
      details: `${agent.login} — créé depuis la feuille d'émargement`,
    });
  }

  await enregistrerPresence(seanceId, agent.id, "PRESENT", `coach:${coach.id}`);
  await audit("PARTICIPANT_PONCTUEL", {
    acteur: `${coach.prenom} ${coach.nom}`,
    cible: agent.displayName,
    details: seanceId,
  });

  let suite = "";
  if (formData.get("inscrire") === "on") {
    const existante = await prisma.inscription.findUnique({
      where: { creneauId_userId: { creneauId: seance.creneauId, userId: agent.id } },
    });
    if (existante && ["VALIDEE", "EN_ATTENTE", "LISTE_ATTENTE"].includes(existante.statut)) {
      suite = " Il était déjà positionné sur ce créneau.";
    } else {
      const data = {
        statut: "EN_ATTENTE" as const,
        rang: null,
        demandeAt: new Date(),
        decisionAt: null,
        decidePar: null,
        motif: null,
        commentaire: `Venu à la séance du ${seance.date.toISOString().slice(0, 10)}, signalé par l'animateur`,
      };
      if (existante) {
        await prisma.inscription.update({ where: { id: existante.id }, data });
      } else {
        await prisma.inscription.create({
          data: { creneauId: seance.creneauId, userId: agent.id, ...data },
        });
      }
      await audit("INSCRIPTION_DEPUIS_SEANCE", {
        acteur: `${coach.prenom} ${coach.nom}`,
        cible: agent.displayName,
        details: "EN_ATTENTE",
      });
      suite = " Demande d'inscription transmise au service des sports.";
    }
  }

  // La capacité ne bloque jamais l'animateur : la personne est là, devant lui,
  // et une feuille qui refuse de l'enregistrer produit une fréquentation
  // fausse. On l'informe du dépassement — et le service des sports le lit au
  // journal — mais l'ajout passe.
  const [surLaFeuille, creneau] = await Promise.all([
    prisma.presence.count({ where: { seanceId, etat: "PRESENT" } }),
    prisma.creneau.findUnique({
      where: { id: seance.creneauId },
      select: { capacite: true },
    }),
  ]);
  const capacite = creneau?.capacite ?? 0;
  const depassement =
    capacite > 0 && surLaFeuille > capacite
      ? ` Attention : ${surLaFeuille} présents pour ${capacite} places prévues.`
      : "";
  if (depassement) {
    await audit("SEANCE_CAPACITE_DEPASSEE", {
      acteur: `${coach.prenom} ${coach.nom}`,
      cible: `${seance.creneau.activite.nom} ${seance.date.toISOString().slice(0, 10)}`,
      details: `${surLaFeuille}/${capacite}`,
    });
  }

  revalidatePath(`/emargement/${token}/${seanceId}`);
  revalidatePath(`/seances/${seanceId}`);
  revalidatePath("/inscriptions");
  return succes(`${agent.displayName} ajouté à la feuille.${suite}${depassement}`);
}

/**
 * Rétablit une séance que l'animateur avait annulée par anticipation.
 *
 * L'empêchement se lève parfois — remplaçant trouvé, salle rendue —, et sans
 * ce geste il fallait appeler le service des sports. Les inscrits sont
 * reprévenus : ils avaient rayé la date de leur agenda.
 *
 * Limité aux séances à venir et non émargées : rétablir une séance passée
 * reviendrait à réécrire l'historique.
 */
export async function retablirSeanceAVenir(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const seanceId = String(formData.get("seanceId") ?? "");

  const ctx = await seanceDuCoach(token, seanceId);
  if (!ctx) return erreur("Séance introuvable.");
  const { coach, seance } = ctx;
  if (seance.statut !== "ANNULEE") return erreur("Cette séance n'est pas annulée.");
  if (seance.date < aujourdhui()) {
    return erreur("Séance passée : le service des sports peut encore la rétablir.");
  }

  await prisma.seance.update({
    where: { id: seanceId },
    data: { statut: "PLANIFIEE", motifAnnulation: null, clotureeAt: null, clotureePar: null },
  });
  await audit("SEANCE_RETABLIE", {
    acteur: `${coach.prenom} ${coach.nom}`,
    cible: `${seance.creneau.activite.nom} ${seance.date.toISOString().slice(0, 10)}`,
  });

  const res = await notifierSeanceRetablie(seanceId);

  revalidatePath(`/emargement/${token}`);
  revalidatePath(`/emargement/${token}/${seanceId}`);
  revalidatePath("/seances");
  revalidatePath("/mes-activites");
  return succes(
    res.envoyes > 0
      ? `Séance rétablie. ${res.envoyes} inscrit${res.envoyes > 1 ? "s" : ""} prévenu${res.envoyes > 1 ? "s" : ""}.`
      : "Séance rétablie.",
  );
}

/**
 * Annulation par l'animateur d'une séance **à venir**, et éventuellement des
 * suivantes du même créneau jusqu'à une date.
 *
 * Distincte de la déclaration « la séance n'a pas eu lieu » : ici il prévient,
 * et les inscrits sont donc informés par courriel — un seul message chacun,
 * même pour six semaines d'arrêt. La feuille n'est pas close : le service des
 * sports peut rétablir les séances si l'empêchement se lève.
 */
export async function annulerSeanceAVenir(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const seanceId = String(formData.get("seanceId") ?? "");
  const motif = String(formData.get("motif") ?? "").trim();
  const jusqua = String(formData.get("jusqua") ?? "").trim();
  if (!motif) return erreur("Indiquez pourquoi la séance n'aura pas lieu.");

  const ctx = await seanceDuCoach(token, seanceId);
  if (!ctx) return erreur("Séance introuvable.");
  const { coach, seance } = ctx;
  if (seance.statut === "ANNULEE") return erreur("Cette séance est déjà annulée.");
  if (seance.date < aujourdhui()) {
    return erreur("Séance passée : ouvrez sa feuille pour la déclarer non tenue.");
  }

  // Le lot ne dépasse jamais le créneau de la séance ouverte : un empêchement
  // porte sur un rendez-vous hebdomadaire, pas sur toute l'activité.
  const fin = jusqua ? jourUtc(jusqua) : seance.date;
  if (fin < seance.date) return erreur("La date de reprise doit suivre cette séance.");

  const seances = await prisma.seance.findMany({
    where: {
      creneauId: seance.creneauId,
      statut: "PLANIFIEE",
      date: { gte: seance.date, lte: fin },
    },
    orderBy: { date: "asc" },
    select: { id: true },
  });
  if (seances.length === 0) return erreur("Aucune séance à annuler sur cette période.");
  const ids = seances.map((s) => s.id);

  await prisma.seance.updateMany({
    where: { id: { in: ids } },
    data: { statut: "ANNULEE", motifAnnulation: motif },
  });
  await audit("SEANCE_ANNULEE_AVANCE", {
    acteur: `${coach.prenom} ${coach.nom}`,
    cible: `${seance.creneau.activite.nom} — ${ids.length} séance(s) à partir du ${seance.date.toISOString().slice(0, 10)}`,
    details: motif,
  });

  const res = await notifierSeancesAnnulees(ids, motif);
  const quoi =
    ids.length > 1 ? `${ids.length} séances annulées` : "Séance annulée";

  revalidatePath(`/emargement/${token}`);
  revalidatePath("/seances");
  revalidatePath("/mes-activites");
  return succes(
    res.envoyes > 0
      ? `${quoi}. ${res.envoyes} inscrit${res.envoyes > 1 ? "s" : ""} prévenu${res.envoyes > 1 ? "s" : ""}.`
      : res.destinataires > 0
        ? `${quoi}, mais aucun inscrit n'a pu être prévenu par courriel. Signalez-le au service des sports.`
        : `${quoi}. Aucun inscrit à prévenir.`,
  );
}
