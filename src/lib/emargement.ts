import type { EtatPresence } from "@prisma/client";
import { prisma } from "./db";
import { aujourdhui, ajouterJours } from "./dates";
import { participeALaSeance } from "./inscriptions";

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
      participations: { include: { user: true } },
    },
  });
  if (!seance) return null;

  // Un agent inscrit en cours de saison ne figure que sur les séances à partir
  // de son inscription : les feuilles antérieures ne le listent pas, sans quoi
  // il y apparaîtrait absent à des séances qui ne le concernaient pas.
  const inscriptions = (
    await prisma.inscription.findMany({
      where: { creneauId: seance.creneauId, statut: "VALIDEE" },
      include: { user: true },
    })
  ).filter((i) => participeALaSeance(i, seance.date));

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

  // Attendus à cette seule séance sans y avoir encore été pointés : le service
  // des sports les a annoncés à l'avance. Sans cette reprise ils n'apparaîtraient
  // sur la feuille qu'après coup, et l'animateur n'aurait personne à pointer.
  const dejaListes = new Set(lignes.map((l) => l.userId));
  for (const p of seance.participations) {
    if (dejaListes.has(p.userId)) continue;
    lignes.push({
      userId: p.userId,
      nom: p.user.displayName,
      service: p.user.service,
      direction: p.user.direction,
      inscriptionId: null,
      etat: null,
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
 * Fenêtre de réclamation des feuilles manquantes.
 *
 * Deux mois : au-delà, la séance est trop ancienne pour qu'un animateur s'en
 * souvienne. Le jour même est exclu — une séance du soir n'est pas en retard à
 * midi. La tuile du tableau de bord et le filtre du planning s'appuient tous
 * deux dessus, sans quoi l'une annonçait zéro et l'autre listait des séances.
 */
export const JOURS_FEUILLES_MANQUANTES = 60;

/**
 * Restreint une liste de séances à celles qui ont réellement une feuille à
 * compléter : au moins un inscrit attendu à cette date, ou un pointage déjà
 * saisi. Une séance sans personne n'a rien à émarger — la réclamer met
 * l'animateur devant une feuille vide, qu'il ne peut d'ailleurs pas
 * transmettre puisque la clôture exige au moins un pointage.
 */
export async function feuillesAttendues<
  T extends { id: string; date: Date; creneauId: string },
>(seances: T[]): Promise<T[]> {
  if (seances.length === 0) return seances;

  const creneauIds = [...new Set(seances.map((s) => s.creneauId))];
  const seanceIds = seances.map((s) => s.id);
  const [creneauxPointes, inscriptions, pointages, attendus] = await Promise.all([
    // Une activité pratiquée en autonomie n'a personne pour pointer : ses
    // séances ne doivent jamais figurer parmi les feuilles attendues, sans quoi
    // l'alerte du tableau de bord réclame indéfiniment une feuille qui
    // n'existera pas.
    prisma.creneau.findMany({
      where: { id: { in: creneauIds }, activite: { suiviPresence: true } },
      select: { id: true },
    }),
    prisma.inscription.findMany({
      where: { creneauId: { in: creneauIds }, statut: "VALIDEE" },
      select: { creneauId: true, decisionAt: true, demandeAt: true },
    }),
    prisma.presence.findMany({
      where: { seanceId: { in: seanceIds } },
      select: { seanceId: true },
      distinct: ["seanceId"],
    }),
    // Un participant annoncé sur cette seule séance suffit à la rendre
    // émargeable, même si son créneau n'a aucun inscrit.
    prisma.participationPonctuelle.findMany({
      where: { seanceId: { in: seanceIds } },
      select: { seanceId: true },
      distinct: ["seanceId"],
    }),
  ]);

  const parCreneau = new Map<string, { decisionAt: Date | null; demandeAt: Date }[]>();
  for (const i of inscriptions) {
    const liste = parCreneau.get(i.creneauId);
    if (liste) liste.push(i);
    else parCreneau.set(i.creneauId, [i]);
  }
  const pointees = new Set(pointages.map((p) => p.seanceId));
  const annoncees = new Set(attendus.map((p) => p.seanceId));
  const emargeables = new Set(creneauxPointes.map((c) => c.id));

  return seances.filter(
    (s) =>
      emargeables.has(s.creneauId) &&
      (pointees.has(s.id) ||
        annoncees.has(s.id) ||
        (parCreneau.get(s.creneauId) ?? []).some((i) => participeALaSeance(i, s.date))),
  );
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
