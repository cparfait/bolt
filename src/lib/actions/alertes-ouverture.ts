"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAgent } from "@/lib/session";
import { audit } from "@/lib/audit";
import { adresseDeContact } from "@/lib/comptes";
import { basculerAlerte } from "@/lib/alertes-ouverture";
import { saisonOuverte } from "@/lib/saison";
import { erreur, succes, type ActionState } from "./types";

/**
 * L'agent demande — ou retire — une alerte d'ouverture sur un créneau fermé.
 *
 * `requireAgent` : c'est un geste sur ses propres données, depuis l'espace
 * agent, joignable d'Internet. Le créneau doit être visible dans le catalogue
 * (saison ouverte, activité vivante) et réellement fermé : poser une alerte
 * sur un créneau ouvert n'aurait aucun sens, et l'écran ne le propose pas.
 */
export async function basculerAlerteOuvertureAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAgent();
  const creneauId = String(formData.get("creneauId") ?? "");

  const creneau = await prisma.creneau.findUnique({
    where: { id: creneauId },
    include: { activite: { select: { nom: true, actif: true, archiveAt: true } } },
  });
  const saison = await saisonOuverte();
  if (
    !creneau ||
    creneau.archiveAt ||
    !creneau.activite.actif ||
    creneau.activite.archiveAt ||
    creneau.saisonId !== saison?.id
  ) {
    return erreur("Ce créneau n'est pas proposé pour l'instant.");
  }
  if (creneau.ouvertInscription) {
    return erreur("Les inscriptions à ce créneau sont déjà ouvertes.");
  }
  if (!adresseDeContact(user)) {
    return erreur(
      "Aucune adresse de courriel n'est enregistrée pour vous : demandez au service des sports de l'ajouter sur votre fiche.",
    );
  }

  const { posee } = await basculerAlerte(user.id, creneauId);
  await audit(posee ? "ALERTE_OUVERTURE_POSEE" : "ALERTE_OUVERTURE_RETIREE", {
    userId: user.id,
    cible: creneau.activite.nom,
  });
  revalidatePath("/mes-activites");
  return succes(
    posee
      ? "Vous serez prévenu par courriel dès l'ouverture des inscriptions."
      : "Vous ne serez plus prévenu pour ce créneau.",
  );
}
