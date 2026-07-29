"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { aujourdhui } from "@/lib/dates";
import { erreur, succes, type ActionState } from "./types";

/**
 * Absences annoncées par l'agent lui-même.
 *
 * Prévenir sert à deux choses : l'animateur n'attend pas quelqu'un qui ne
 * viendra pas, et le service des sports distingue un désistement ponctuel d'un
 * décrochage. Une absence annoncée ne crée pas de présence : elle n'a donc
 * aucun effet sur les statistiques tant que la séance n'est pas émargée, et
 * l'agent qui vient finalement peut être pointé présent normalement.
 */

/** Vérifie que l'agent peut encore se déclarer absent sur cette séance. */
async function seanceDeclarable(seanceId: string, userId: string) {
  const seance = await prisma.seance.findUnique({
    where: { id: seanceId },
    include: { creneau: { include: { activite: true } } },
  });
  if (!seance) return { erreur: "Séance introuvable." };
  if (seance.statut === "ANNULEE") return { erreur: "Cette séance est déjà annulée." };
  if (seance.clotureeAt) {
    return { erreur: "La feuille de cette séance a déjà été transmise." };
  }
  if (seance.date < aujourdhui()) {
    return { erreur: "Cette séance est passée : prévenez directement l'animateur." };
  }

  const inscrit = await prisma.inscription.findFirst({
    where: { creneauId: seance.creneauId, userId, statut: "VALIDEE" },
    select: { id: true },
  });
  if (!inscrit) return { erreur: "Vous n'êtes pas inscrit à ce créneau." };

  return { seance };
}

/**
 * Déclaration d'absence par le service des sports, pour le compte d'un agent
 * qui a prévenu par téléphone ou en passant au bureau — tout le monde ne
 * passera pas par l'application.
 */
export async function declarerAbsencePourAgent(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const acteur = await requireUser("GESTIONNAIRE");
  const seanceId = String(formData.get("seanceId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const motif = String(formData.get("motif") ?? "").trim();
  if (!seanceId || !userId) return erreur("Sélectionnez une séance.");

  const verif = await seanceDeclarable(seanceId, userId);
  if (verif.erreur) return erreur(verif.erreur);
  const seance = verif.seance!;

  const agent = await prisma.user.findUnique({ where: { id: userId } });
  if (!agent) return erreur("Agent introuvable.");

  await prisma.absenceAnnoncee.upsert({
    where: { seanceId_userId: { seanceId, userId } },
    update: { motif: motif || null },
    create: { seanceId, userId, motif: motif || null },
  });

  await audit("ABSENCE_ANNONCEE", {
    userId: acteur.id,
    cible: `${agent.displayName} — ${seance.creneau.activite.nom} ${seance.date.toISOString().slice(0, 10)}`,
    details: motif || "saisie par le service des sports",
  });

  revalidatePath(`/agents/${userId}`);
  revalidatePath(`/seances/${seanceId}`);
  return succes(
    `Absence de ${agent.displayName} signalée pour le ${seance.date.toLocaleDateString("fr-FR")}.`,
  );
}

/** Retrait d'une absence annoncée, par le service des sports. */
export async function annulerAbsencePourAgent(
  seanceId: string,
  userId: string,
): Promise<void> {
  const acteur = await requireUser("GESTIONNAIRE");
  const supprimees = await prisma.absenceAnnoncee.deleteMany({ where: { seanceId, userId } });
  if (supprimees.count === 0) return;
  await audit("ABSENCE_ANNULEE", { userId: acteur.id, cible: userId });
  revalidatePath(`/agents/${userId}`);
  revalidatePath(`/seances/${seanceId}`);
}

/**
 * Déclaration d'absence par l'agent, sur une séance ou sur plusieurs.
 *
 * Une absence tient rarement en une séance : congés, arrêt, formation, mission
 * à l'extérieur. Reprendre le geste séance par séance était fastidieux, et
 * surtout on en oubliait — l'animateur attendait alors quelqu'un qui ne
 * viendrait pas. Le formulaire envoie donc la liste des séances couvertes, et
 * chacune est revérifiée ici : la liste vient du navigateur, elle n'autorise
 * rien par elle-même.
 */
export async function declarerAbsence(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const ids = formData.getAll("seanceId").map(String).filter(Boolean);
  const motif = String(formData.get("motif") ?? "").trim();
  if (ids.length === 0) return erreur("Sélectionnez une séance.");

  const retenues: { id: string; libelle: string }[] = [];
  let premiereErreur: string | null = null;

  for (const seanceId of ids) {
    const verif = await seanceDeclarable(seanceId, user.id);
    if (verif.erreur) {
      premiereErreur ??= verif.erreur;
      continue;
    }
    const seance = verif.seance!;
    await prisma.absenceAnnoncee.upsert({
      where: { seanceId_userId: { seanceId, userId: user.id } },
      update: { motif: motif || null },
      create: { seanceId, userId: user.id, motif: motif || null },
    });
    retenues.push({
      id: seanceId,
      libelle: `${seance.creneau.activite.nom} ${seance.date.toISOString().slice(0, 10)}`,
    });
  }

  // Aucune séance retenue : c'est une vraie erreur, on renvoie la première
  // raison plutôt qu'un succès mensonger.
  if (retenues.length === 0) {
    return erreur(premiereErreur ?? "Aucune séance ne peut être déclarée.");
  }

  await audit("ABSENCE_ANNONCEE", {
    userId: user.id,
    cible: retenues.length === 1 ? retenues[0].libelle : `${retenues.length} séances`,
    details: motif || undefined,
  });

  revalidatePath("/mes-activites");
  revalidatePath("/");
  for (const r of retenues) revalidatePath(`/seances/${r.id}`);

  return succes(
    retenues.length === 1
      ? "Absence signalée. L'animateur en est informé."
      : `Absence signalée pour ${retenues.length} séances. Les animateurs en sont informés.`,
  );
}

/**
 * L'agent revient sur son absence — « finalement je viens » — sur une séance ou
 * sur toutes celles qu'il avait signalées d'un coup. Se déclarer absent pour
 * trois semaines puis voir ses congés annulés est assez courant pour mériter
 * autre chose que trois clics.
 *
 * Une feuille déjà transmise n'est pas touchée : l'animateur a constaté.
 */
export async function annulerAbsence(seanceIds: string[]): Promise<void> {
  const user = await requireUser();
  if (seanceIds.length === 0) return;

  const seances = await prisma.seance.findMany({
    where: { id: { in: seanceIds }, clotureeAt: null },
    include: { creneau: { include: { activite: true } } },
    orderBy: { date: "asc" },
  });
  if (seances.length === 0) return;

  const supprimees = await prisma.absenceAnnoncee.deleteMany({
    where: { seanceId: { in: seances.map((s) => s.id) }, userId: user.id },
  });
  if (supprimees.count === 0) return;

  await audit("ABSENCE_ANNULEE", {
    userId: user.id,
    cible:
      supprimees.count === 1
        ? `${seances[0].creneau.activite.nom} ${seances[0].date.toISOString().slice(0, 10)}`
        : `${supprimees.count} séances`,
  });
  revalidatePath("/mes-activites");
  revalidatePath("/");
  for (const s of seances) revalidatePath(`/seances/${s.id}`);
}

/**
 * Prochaines séances d'un agent, avec l'absence éventuellement déjà annoncée.
 * Sert à la fois au tableau de bord et à la page « Mes activités ».
 *
 * Les séances annulées restent dans la liste, signalées comme telles : les
 * retirer ferait disparaître sans explication un rendez-vous que l'agent avait
 * noté, et le courriel d'annulation peut très bien ne pas avoir été lu.
 */
export async function prochainesSeancesDe(userId: string, limite = 12) {
  const seances = await prisma.seance.findMany({
    where: {
      clotureeAt: null,
      date: { gte: aujourdhui() },
      creneau: { inscriptions: { some: { userId, statut: "VALIDEE" } } },
    },
    include: {
      creneau: { include: { activite: true } },
      absences: { where: { userId }, select: { motif: true } },
    },
    orderBy: [{ date: "asc" }, { creneau: { heureDebut: "asc" } }],
    take: limite,
  });

  return seances.map((s) => ({
    id: s.id,
    date: s.date,
    heureDebut: s.creneau.heureDebut,
    heureFin: s.creneau.heureFin,
    lieu: s.creneau.lieu,
    activite: s.creneau.activite.nom,
    couleur: s.creneau.activite.couleur,
    absent: s.absences.length > 0,
    motif: s.absences[0]?.motif ?? null,
    annulee: s.statut === "ANNULEE",
    motifAnnulation: s.motifAnnulation,
  }));
}
