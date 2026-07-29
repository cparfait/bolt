import type { EtatPresence } from "@prisma/client";
import { prisma } from "./db";
import { aujourdhui, ajouterJours } from "./dates";

/** Une ligne de la feuille : l'inscrit et son état s'il a déjà été pointé. */
export type LigneFeuille = {
  userId: string;
  nom: string;
  service: string | null;
  direction: string | null;
  inscriptionId: string | null;
  etat: EtatPresence | null;
  ponctuel: boolean; // participant non inscrit au créneau
  // L'agent a prévenu qu'il ne viendrait pas : l'animateur ne l'attend pas et
  // « tout le monde est là » ne doit pas le marquer présent par mégarde.
  absenceAnnoncee: boolean;
  motifAbsence: string | null;
};

export type Feuille = NonNullable<Awaited<ReturnType<typeof feuilleDeSeance>>>;

/**
 * Construit la feuille d'émargement d'une séance : les inscrits validés du
 * créneau, plus les éventuels participants ponctuels déjà pointés.
 *
 * Les lignes ne sont pas pré-créées en base. Une séance sans aucune présence
 * saisie reste « non émargée » — distinction indispensable pour les statistiques :
 * une séance oubliée ne doit pas se lire comme une séance où personne n'est venu.
 */
export async function feuilleDeSeance(seanceId: string) {
  const seance = await prisma.seance.findUnique({
    where: { id: seanceId },
    include: {
      creneau: { include: { activite: true, animateurs: true, saison: true } },
      presences: { include: { user: true } },
      absences: true,
    },
  });
  if (!seance) return null;

  const inscriptions = await prisma.inscription.findMany({
    where: { creneauId: seance.creneauId, statut: "VALIDEE" },
    include: { user: true },
  });

  const parUser = new Map(seance.presences.map((p) => [p.userId, p]));
  const prevenus = new Map(seance.absences.map((a) => [a.userId, a.motif]));

  const lignes: LigneFeuille[] = inscriptions.map((i) => ({
    userId: i.userId,
    nom: i.user.displayName,
    service: i.user.service,
    direction: i.user.direction,
    inscriptionId: i.id,
    etat: parUser.get(i.userId)?.etat ?? null,
    ponctuel: false,
    absenceAnnoncee: prevenus.has(i.userId),
    motifAbsence: prevenus.get(i.userId) ?? null,
  }));

  // Participants pointés sans être inscrits (remplacement, essai).
  const inscritsIds = new Set(inscriptions.map((i) => i.userId));
  for (const p of seance.presences) {
    if (inscritsIds.has(p.userId)) continue;
    lignes.push({
      userId: p.userId,
      nom: p.user.displayName,
      service: p.user.service,
      direction: p.user.direction,
      inscriptionId: p.inscriptionId,
      etat: p.etat,
      ponctuel: true,
      absenceAnnoncee: prevenus.has(p.userId),
      motifAbsence: prevenus.get(p.userId) ?? null,
    });
  }

  lignes.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

  return { seance, lignes, effectif: inscriptions.length };
}

/**
 * Enregistre (ou corrige) l'état d'un participant.
 * Bascule la séance en « émargée » dès le premier pointage.
 */
export async function enregistrerPresence(
  seanceId: string,
  userId: string,
  etat: EtatPresence,
  saisiPar: string,
): Promise<void> {
  const inscription = await prisma.inscription.findFirst({
    where: {
      userId,
      creneau: { seances: { some: { id: seanceId } } },
      statut: "VALIDEE",
    },
    select: { id: true },
  });

  await prisma.presence.upsert({
    where: { seanceId_userId: { seanceId, userId } },
    update: { etat, saisiAt: new Date(), saisiPar },
    create: {
      seanceId,
      userId,
      inscriptionId: inscription?.id ?? null,
      etat,
      saisiPar,
    },
  });

  await prisma.seance.updateMany({
    where: { id: seanceId, statut: "PLANIFIEE" },
    data: { statut: "FAITE" },
  });
}

/** Retire une ligne de la feuille (correction d'un pointage erroné). */
export async function retirerPresence(seanceId: string, userId: string): Promise<void> {
  await prisma.presence.deleteMany({ where: { seanceId, userId } });
  const reste = await prisma.presence.count({ where: { seanceId } });
  if (reste === 0) {
    await prisma.seance.updateMany({
      where: { id: seanceId, statut: "FAITE" },
      data: { statut: "PLANIFIEE" },
    });
  }
}

/**
 * Séances d'un animateur autour d'aujourd'hui.
 * La feuille s'ouvre sur la séance du jour ; la fenêtre glissante permet de
 * rattraper un oubli de la veille sans naviguer dans un calendrier.
 */
export async function seancesDuCoach(coachId: string, joursAvant = 14, joursApres = 14) {
  const debut = ajouterJours(aujourdhui(), -joursAvant);
  const fin = ajouterJours(aujourdhui(), joursApres);
  return prisma.seance.findMany({
    where: {
      creneau: { animateurs: { some: { id: coachId } } },
      date: { gte: debut, lte: fin },
    },
    include: { creneau: { include: { activite: true } }, _count: { select: { presences: true } } },
    orderBy: [{ date: "asc" }, { creneau: { heureDebut: "asc" } }],
  });
}

/** Fenêtre de saisie : au-delà, seul un gestionnaire peut corriger. */
export const JOURS_SAISIE_COACH = 14;

export function saisieOuverte(date: Date): boolean {
  const limite = ajouterJours(aujourdhui(), -JOURS_SAISIE_COACH);
  return date >= limite && date <= ajouterJours(aujourdhui(), 1);
}
