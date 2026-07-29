"use server";

import { revalidatePath } from "next/cache";
import type { EtatPresence } from "@prisma/client";
import { prisma } from "@/lib/db";
import { estGestionnaire, requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { aujourdhui } from "@/lib/dates";
import { enregistrerPresence, retirerPresence } from "@/lib/emargement";
import { inscrireDirectement } from "@/lib/inscriptions";
import { notifierSeancesAnnulees } from "@/lib/notifications";
import { assurerCompteAgent } from "./agents";
import { erreur, succes, type ActionState } from "./types";

const ETATS: EtatPresence[] = ["PRESENT", "ABSENT"];

/**
 * Vérifie qu'un utilisateur a le droit d'écrire sur une séance :
 * gestionnaires partout, animateur connecté par compte uniquement sur ses
 * propres créneaux.
 */
async function seanceAutorisee(seanceId: string, userId: string, role: string) {
  const seance = await prisma.seance.findUnique({
    where: { id: seanceId },
    include: { creneau: { include: { animateurs: true, activite: true } } },
  });
  if (!seance) return null;
  if (role === "ADMIN" || role === "GESTIONNAIRE") return seance;
  // Un animateur n'écrit que sur les créneaux qu'il anime — il peut y en
  // avoir plusieurs par créneau depuis la co-animation.
  if (role === "COACH" && seance.creneau.animateurs.some((a) => a.userId === userId))
    return seance;
  return null;
}

/** Pointage depuis le back-office (gestionnaire, ou animateur avec compte). */
export async function pointerAction(
  seanceId: string,
  userId: string,
  etat: string,
): Promise<void> {
  const acteur = await requireUser();
  const seance = await seanceAutorisee(seanceId, acteur.id, acteur.role);
  if (!seance) return;
  if (seance.clotureeAt && !estGestionnaire(acteur)) return;
  if (!ETATS.includes(etat as EtatPresence)) return;

  await enregistrerPresence(seanceId, userId, etat as EtatPresence, `user:${acteur.login}`);
  revalidatePath(`/seances/${seanceId}`);
}

export async function depointerAction(seanceId: string, userId: string): Promise<void> {
  const acteur = await requireUser();
  const seance = await seanceAutorisee(seanceId, acteur.id, acteur.role);
  if (!seance) return;
  if (seance.clotureeAt && !estGestionnaire(acteur)) return;
  await retirerPresence(seanceId, userId);
  revalidatePath(`/seances/${seanceId}`);
}

export async function annulerSeance(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const acteur = await requireUser();
  const seanceId = String(formData.get("seanceId") ?? "");
  const motif = String(formData.get("motif") ?? "").trim();
  const seance = await seanceAutorisee(seanceId, acteur.id, acteur.role);
  if (!seance) return erreur("Séance introuvable ou hors de votre périmètre.");
  if (!motif) return erreur("Indiquez le motif de l'annulation.");

  await prisma.seance.update({
    where: { id: seanceId },
    data: { statut: "ANNULEE", motifAnnulation: motif },
  });
  await audit("SEANCE_ANNULEE", {
    userId: acteur.id,
    cible: `${seance.creneau.activite.nom} ${seance.date.toISOString().slice(0, 10)}`,
    details: motif,
  });

  // Séance à venir : les inscrits ont prévu de s'y rendre. Prévenir n'a en
  // revanche aucun sens sur une séance passée qu'on se contente de constater.
  const information = formData.get("prevenir") === "on" ? await prevenir([seanceId], motif) : "";

  revalidatePath("/seances");
  revalidatePath("/seances/calendrier");
  revalidatePath(`/seances/${seanceId}`);
  revalidatePath("/mes-activites");
  revalidatePath("/");
  return succes(`Séance annulée.${information}`);
}

/** Libellé du résultat d'envoi, commun à l'annulation simple et groupée. */
async function prevenir(seanceIds: string[], motif: string): Promise<string> {
  const res = await notifierSeancesAnnulees(seanceIds, motif);
  if (res.envoyes > 0) {
    return ` ${res.envoyes} inscrit${res.envoyes > 1 ? "s" : ""} prévenu${res.envoyes > 1 ? "s" : ""} par courriel.`;
  }
  if (res.destinataires > 0) {
    return " Aucun inscrit n'a pu être prévenu — vérifiez la messagerie et leurs adresses.";
  }
  return " Aucun inscrit à prévenir.";
}

/**
 * Annulation anticipée d'un lot de séances : fermeture de la piscine, absence
 * de l'animateur sur trois semaines, travaux dans le gymnase…
 *
 * Volontairement limitée aux séances à venir et encore planifiées : une séance
 * déjà émargée porte de l'historique de fréquentation, et une séance passée se
 * constate au cas par cas depuis sa propre fiche. Rien n'est supprimé — une
 * annulation se rétablit.
 */
export async function annulerSeances(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const acteur = await requireUser("GESTIONNAIRE", "COACH");
  const ids = formData.getAll("seance").map(String).filter(Boolean);
  const motif = String(formData.get("motif") ?? "").trim();
  if (ids.length === 0) return erreur("Sélectionnez au moins une séance.");
  if (!motif) return erreur("Indiquez le motif de l'annulation.");

  // Un animateur n'annule que sur les créneaux qu'il anime. Le filtre est
  // réappliqué ici et pas seulement à l'affichage : la liste envoyée par le
  // navigateur n'est jamais une autorisation.
  const coach = estGestionnaire(acteur)
    ? null
    : await prisma.coach.findUnique({ where: { userId: acteur.id } });
  if (!estGestionnaire(acteur) && !coach) {
    return erreur("Aucun créneau ne vous est rattaché.");
  }

  const seances = await prisma.seance.findMany({
    where: {
      id: { in: ids },
      statut: "PLANIFIEE",
      date: { gte: aujourdhui() },
      ...(coach ? { creneau: { animateurs: { some: { id: coach.id } } } } : {}),
    },
    include: { creneau: { include: { activite: { select: { nom: true } } } } },
    orderBy: { date: "asc" },
  });
  if (seances.length === 0) {
    return erreur(
      "Aucune séance annulable dans la sélection : elles sont déjà annulées, émargées ou passées.",
    );
  }

  await prisma.seance.updateMany({
    where: { id: { in: seances.map((s) => s.id) } },
    data: { statut: "ANNULEE", motifAnnulation: motif },
  });

  const periode =
    seances.length > 1
      ? `${seances[0].date.toISOString().slice(0, 10)} → ${seances[seances.length - 1].date.toISOString().slice(0, 10)}`
      : seances[0].date.toISOString().slice(0, 10);
  await audit("SEANCES_ANNULEES", {
    userId: acteur.id,
    cible: `${seances.length} séance(s) — ${periode}`,
    details: motif,
  });

  const information =
    formData.get("prevenir") === "on"
      ? await prevenir(seances.map((s) => s.id), motif)
      : "";
  const ignorees = ids.length - seances.length;

  revalidatePath("/seances");
  revalidatePath("/seances/annuler");
  revalidatePath("/seances/calendrier");
  revalidatePath("/mes-activites");
  revalidatePath("/");
  return succes(
    `${seances.length} séance${seances.length > 1 ? "s" : ""} annulée${seances.length > 1 ? "s" : ""}.${information}` +
      (ignorees > 0
        ? ` ${ignorees} séance${ignorees > 1 ? "s" : ""} ignorée${ignorees > 1 ? "s" : ""} (déjà annulée, émargée ou passée).`
        : ""),
  );
}

export async function retablirSeance(seanceId: string): Promise<void> {
  const acteur = await requireUser("GESTIONNAIRE");
  const seance = await prisma.seance.findUnique({
    where: { id: seanceId },
    include: { _count: { select: { presences: true } } },
  });
  if (!seance) return;
  await prisma.seance.update({
    where: { id: seanceId },
    data: {
      statut: seance._count.presences > 0 ? "FAITE" : "PLANIFIEE",
      motifAnnulation: null,
    },
  });
  await audit("SEANCE_RETABLIE", { userId: acteur.id, cible: seanceId });
  revalidatePath("/seances");
  revalidatePath("/seances/calendrier");
  revalidatePath(`/seances/${seanceId}`);
}

/** Fige la feuille : plus aucune modification par l'animateur. */
export async function cloturerSeance(seanceId: string): Promise<void> {
  const acteur = await requireUser();
  const seance = await seanceAutorisee(seanceId, acteur.id, acteur.role);
  if (!seance) return;
  await prisma.seance.update({
    where: { id: seanceId },
    data: { clotureeAt: new Date(), clotureePar: acteur.displayName },
  });
  await audit("SEANCE_CLOTUREE", { userId: acteur.id, cible: seanceId });
  revalidatePath(`/seances/${seanceId}`);
}

export async function rouvrirSeance(seanceId: string): Promise<void> {
  const acteur = await requireUser("GESTIONNAIRE");
  await prisma.seance.update({
    where: { id: seanceId },
    data: { clotureeAt: null, clotureePar: null },
  });
  await audit("SEANCE_ROUVERTE", { userId: acteur.id, cible: seanceId });
  revalidatePath(`/seances/${seanceId}`);
}

export async function commenterSeance(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const acteur = await requireUser();
  const seanceId = String(formData.get("seanceId") ?? "");
  const seance = await seanceAutorisee(seanceId, acteur.id, acteur.role);
  if (!seance) return erreur("Séance introuvable.");
  await prisma.seance.update({
    where: { id: seanceId },
    data: { commentaire: String(formData.get("commentaire") ?? "").trim() || null },
  });
  revalidatePath(`/seances/${seanceId}`);
  return succes("Commentaire enregistré.");
}

/**
 * Ajoute un participant ponctuel à une séance : un agent qui vient sans être
 * inscrit au créneau (essai, remplacement). Il apparaît dans les statistiques
 * de fréquentation, distinct des inscrits.
 *
 * L'inscription au créneau peut suivre dans le même geste : quelqu'un qui vient
 * une fois revient souvent, et le service des sports n'a pas à ressaisir plus
 * tard une information déjà sous les yeux de l'animateur.
 */
export async function ajouterParticipant(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const acteur = await requireUser();
  const seanceId = String(formData.get("seanceId") ?? "");
  const login = String(formData.get("login") ?? "").trim();
  const seance = await seanceAutorisee(seanceId, acteur.id, acteur.role);
  if (!seance) return erreur("Séance introuvable.");
  if (!login) return erreur("Sélectionnez un agent.");

  // Comme pour les inscriptions, l'agent peut venir de l'annuaire sans compte.
  const userId = await assurerCompteAgent(login);
  const agent = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  if (!userId || !agent) return erreur("Agent introuvable.");

  await enregistrerPresence(seanceId, userId, "PRESENT", `user:${acteur.login}`);
  await audit("PARTICIPANT_PONCTUEL", {
    userId: acteur.id,
    cible: agent.displayName,
    details: seanceId,
  });

  const suite =
    formData.get("inscrire") === "on"
      ? await inscrireAuCreneau(
          seance.creneauId,
          userId,
          agent.displayName,
          estGestionnaire(acteur) ? acteur.displayName : null,
        )
      : "";

  revalidatePath(`/seances/${seanceId}`);
  revalidatePath("/inscriptions");
  return succes(`${agent.displayName} ajouté à la séance.${suite}`);
}

/** Inscrit au créneau un agent venu ponctuellement, et décrit le résultat. */
async function inscrireAuCreneau(
  creneauId: string,
  userId: string,
  nom: string,
  decidePar: string | null,
): Promise<string> {
  const res = await inscrireDirectement(
    creneauId,
    userId,
    decidePar,
    "Venu à une séance sans être inscrit",
  );
  if (res.deja) return ` ${nom} était déjà positionné sur ce créneau.`;

  await audit("INSCRIPTION_DEPUIS_SEANCE", { cible: nom, details: res.statut });
  if (res.statut === "VALIDEE") return ` Inscrit au créneau.`;
  if (res.statut === "LISTE_ATTENTE") {
    return ` Créneau complet : placé en liste d'attente (n°${res.rang}).`;
  }
  return ` Demande d'inscription transmise au service des sports.`;
}
