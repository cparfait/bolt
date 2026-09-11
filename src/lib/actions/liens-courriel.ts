"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { aujourdhui } from "@/lib/dates";
import { absenceAutorisee, placeAutorisee } from "@/lib/liens-courriel";
import { promouvoirTantQuePossible } from "@/lib/inscriptions";
import { erreur, succes, type ActionState } from "./types";

/**
 * Les deux gestes qu'un courriel permet sans compte ni session.
 *
 * Ils ne sont pas gardés par `requireAgent` mais par la signature du lien
 * (src/lib/liens-courriel.ts), et c'est tout le propos : la personne visée est
 * précisément celle qui n'ouvrira pas l'application. La signature est
 * revérifiée ICI, et pas seulement à l'affichage de la page : une action
 * serveur n'est liée à aucun chemin, et le cloisonnement réseau porte sur les
 * chemins (voir src/proxy.ts).
 *
 * Aucune des deux ne peut faire de dégât : la première pose ou retire une
 * intention d'absence, que l'agent corrige d'un second clic ; la seconde rend
 * une place que l'agent venait de recevoir sans l'avoir demandée. Les deux
 * laissent une ligne au journal, avec la mention du canal.
 */

const REFUS = "Ce lien n'est plus valable. Ouvrez l'application pour agir sur votre inscription.";

/**
 * L'agent déclare, ou retire, son absence à une séance depuis le rappel reçu.
 *
 * Le même bouton fait l'aller et le retour : se déclarer absent puis se raviser
 * est courant — une réunion déplacée, un congé annulé —, et un agent qui ne
 * trouve pas comment revenir en arrière finit par ne plus rien déclarer du tout.
 */
export async function basculerAbsenceParLien(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const seanceId = String(formData.get("seanceId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const signature = String(formData.get("signature") ?? "");
  if (!absenceAutorisee(seanceId, userId, signature)) return erreur(REFUS);

  const seance = await prisma.seance.findUnique({
    where: { id: seanceId },
    include: { creneau: { include: { activite: true } } },
  });
  if (!seance) return erreur(REFUS);
  if (seance.statut === "ANNULEE") return erreur("Cette séance est annulée : il n'y a rien à signaler.");
  if (seance.clotureeAt) return erreur("La feuille de cette séance a déjà été transmise.");
  if (seance.date < aujourdhui()) {
    return erreur("Cette séance est passée : prévenez directement l'animateur.");
  }

  const inscrit = await prisma.inscription.findFirst({
    where: { creneauId: seance.creneauId, userId, statut: "VALIDEE" },
    select: { id: true },
  });
  if (!inscrit) return erreur("Vous n'êtes plus inscrit à ce créneau.");

  const dejaAnnoncee = await prisma.absenceAnnoncee.findUnique({
    where: { seanceId_userId: { seanceId, userId } },
    select: { id: true },
  });

  if (dejaAnnoncee) {
    await prisma.absenceAnnoncee.delete({ where: { id: dejaAnnoncee.id } });
    await audit("ABSENCE_ANNULEE", {
      userId,
      cibleId: userId,
      cible: seance.creneau.activite.nom,
      details: "depuis le courriel de rappel",
    });
  } else {
    await prisma.absenceAnnoncee.create({ data: { seanceId, userId } });
    await audit("ABSENCE_ANNONCEE", {
      userId,
      cibleId: userId,
      cible: seance.creneau.activite.nom,
      details: "depuis le courriel de rappel",
    });
  }

  revalidatePath(`/seances/${seanceId}`);
  revalidatePath("/");
  return succes(dejaAnnoncee ? "venue" : "absence");
}

/**
 * L'agent promu depuis la liste d'attente rend la place qu'il vient de recevoir.
 *
 * Une promotion arrive sans avoir été demandée, parfois des mois après
 * l'inscription : entre-temps l'agent a pu changer d'horaires, se blesser, ou
 * simplement ne plus vouloir. Sans ce bouton, la place restait occupée par
 * quelqu'un qui ne viendrait pas — et le suivant de la file, lui, attendait
 * toujours. La place repart aussitôt au suivant, qui est prévenu.
 *
 * Sans retour possible, contrairement à l'absence : la place n'est plus là. On
 * ne la rend donc qu'après un clic sur la page, jamais à l'ouverture du lien.
 */
export async function rendreSaPlaceParLien(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const inscriptionId = String(formData.get("inscriptionId") ?? "");
  const signature = String(formData.get("signature") ?? "");

  // L'inscription d'abord, la signature ensuite : elle porte l'horodatage de
  // la promotion, et c'est celui d'aujourd'hui qui compte — un lien reçu pour
  // une promotion antérieure, avant un désistement et une réinscription, ne
  // rend pas la place obtenue depuis (voir src/lib/liens-courriel.ts).
  const inscription = await prisma.inscription.findUnique({
    where: { id: inscriptionId },
    include: { creneau: { include: { activite: true } } },
  });
  if (!inscription) return erreur(REFUS);
  if (!placeAutorisee(inscription, signature)) return erreur(REFUS);
  if (inscription.statut !== "VALIDEE") {
    return erreur("Cette inscription n'est plus active : il n'y a pas de place à rendre.");
  }

  await prisma.inscription.update({
    where: { id: inscriptionId },
    data: {
      statut: "DESISTEE",
      rang: null,
      decisionAt: new Date(),
      decidePar: "agent",
      motif: "place refusée après promotion depuis la liste d'attente",
    },
  });

  await audit("INSCRIPTION_DESISTEE", {
    userId: inscription.userId,
    cibleId: inscription.userId,
    cible: inscription.creneau.activite.nom,
    details: "place rendue depuis le courriel de promotion",
  });

  // La place repart immédiatement : c'est la seule raison d'être du bouton.
  // En chaîne, pas un seul : en capacité mutualisée, le promu peut déjà
  // détenir une place et n'en consommer aucune — le suivant attendrait pour rien.
  await promouvoirTantQuePossible(inscription.creneauId);

  revalidatePath("/inscriptions");
  revalidatePath("/mes-activites");
  revalidatePath("/");
  return succes(inscription.creneau.activite.nom);
}
