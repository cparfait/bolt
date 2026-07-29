"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { erreur, succes, type ActionState } from "./types";

/**
 * Référentiel des lieux de pratique.
 *
 * Les créneaux stockent le libellé en clair plutôt qu'une clé étrangère : les
 * séances passées et les exports gardent le lieu tel qu'il était, et retirer un
 * lieu de la liste n'efface pas l'historique. La contrepartie est traitée ici —
 * renommer un lieu propage le nouveau libellé aux créneaux qui le portaient.
 */
export async function enregistrerLieu(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const id = String(formData.get("id") ?? "");
  const nom = String(formData.get("nom") ?? "").trim().replace(/\s+/g, " ");
  const adresse = String(formData.get("adresse") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  if (nom.length < 2) return erreur("Indiquez le nom du lieu.");

  const data = { nom, adresse: adresse || null, notes: notes || null };

  try {
    if (id) {
      const avant = await prisma.lieu.findUnique({ where: { id } });
      if (!avant) return erreur("Lieu introuvable.");
      await prisma.lieu.update({ where: { id }, data });
      if (avant.nom !== nom) {
        const touches = await prisma.creneau.updateMany({
          where: { lieu: avant.nom },
          data: { lieu: nom },
        });
        await audit("LIEU_RENOMME", {
          userId: user.id,
          cible: `${avant.nom} → ${nom}`,
          details: `${touches.count} créneau(x) mis à jour`,
        });
      } else {
        await audit("LIEU_MODIFIE", { userId: user.id, cible: nom });
      }
    } else {
      const ordre = await prisma.lieu.count();
      await prisma.lieu.create({ data: { ...data, ordre } });
      await audit("LIEU_CREE", { userId: user.id, cible: nom });
    }
  } catch {
    return erreur("Un lieu porte déjà ce nom.");
  }

  revalidatePath("/parametres/lieux");
  revalidatePath("/activites");
  return succes(`Lieu « ${nom} » enregistré.`);
}

export async function basculerLieu(id: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const lieu = await prisma.lieu.findUnique({ where: { id } });
  if (!lieu) return;
  await prisma.lieu.update({ where: { id }, data: { actif: !lieu.actif } });
  await audit(lieu.actif ? "LIEU_DESACTIVE" : "LIEU_ACTIVE", {
    userId: user.id,
    cible: lieu.nom,
  });
  revalidatePath("/parametres/lieux");
}

/**
 * Suppression, refusée dès qu'un créneau porte encore ce lieu : le libellé
 * disparaîtrait de la liste alors qu'il resterait affiché sur les séances.
 * Un lieu qui ne sert plus se désactive.
 */
export async function supprimerLieu(id: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const lieu = await prisma.lieu.findUnique({ where: { id } });
  if (!lieu) return;
  const utilise = await prisma.creneau.count({ where: { lieu: lieu.nom } });
  if (utilise > 0) return;
  await prisma.lieu.delete({ where: { id } });
  await audit("LIEU_SUPPRIME", { userId: user.id, cible: lieu.nom });
  revalidatePath("/parametres/lieux");
}
