"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { jourUtc } from "@/lib/dates";
import { genererSeancesSaison } from "@/lib/seances";
import { reprendreCreneaux } from "@/lib/saison";
import { pluriel } from "@/lib/constants";
import { erreur, succes, type ActionState } from "./types";

const saisonSchema = z.object({
  nom: z.string().trim().min(3, "Nommez la saison (ex. « 2026-2027 »)."),
  debut: z.string().min(1, "Date de début requise."),
  fin: z.string().min(1, "Date de fin requise."),
});

export async function enregistrerSaison(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const id = String(formData.get("id") ?? "");
  const parsed = saisonSchema.safeParse({
    nom: formData.get("nom"),
    debut: formData.get("debut"),
    fin: formData.get("fin"),
  });
  if (!parsed.success) return erreur(parsed.error.issues[0].message);

  const debut = jourUtc(parsed.data.debut);
  const fin = jourUtc(parsed.data.fin);
  if (fin <= debut) return erreur("La fin de saison doit suivre son début.");

  // La reprise ne vaut qu'à la création : sur une saison existante, elle
  // dupliquerait des créneaux déjà là. Le champ n'est d'ailleurs pas proposé
  // par le formulaire de modification.
  const source = id ? "" : String(formData.get("dupliquerDe") ?? "");

  let creee: { id: string } | null = null;
  try {
    if (id) {
      await prisma.saison.update({ where: { id }, data: { nom: parsed.data.nom, debut, fin } });
    } else {
      creee = await prisma.saison.create({
        data: { nom: parsed.data.nom, debut, fin },
        select: { id: true },
      });
    }
  } catch {
    return erreur("Une saison porte déjà ce nom.");
  }

  await audit(id ? "SAISON_MODIFIEE" : "SAISON_CREEE", {
    userId: user.id,
    cible: parsed.data.nom,
  });
  revalidatePath("/parametres/saisons");

  if (!creee || !source) {
    return succes(`Saison « ${parsed.data.nom} » enregistrée.`);
  }

  // La saison est créée : à partir d'ici, un échec de la reprise ne doit plus
  // être rendu comme un échec de la création. Le gestionnaire repartira du
  // bouton « Regénérer », pas d'une saisie qu'il croirait perdue.
  const modele = await prisma.saison.findUnique({
    where: { id: source },
    select: { nom: true },
  });
  if (!modele) {
    return succes(
      `Saison « ${parsed.data.nom} » créée, mais la saison à reprendre est introuvable : ses créneaux restent à saisir.`,
    );
  }

  let repris: number;
  let ecartes: number;
  try {
    ({ repris, ecartes } = await reprendreCreneaux(source, creee.id));
    await genererSeancesSaison(creee.id);
  } catch {
    // La reprise s'arrête peut-être à mi-chemin : ce qui a été créé est
    // valide, et la page liste les créneaux effectivement en place. Annoncer
    // une saison perdue serait faux et pousserait à la recréer.
    return succes(
      `Saison « ${parsed.data.nom} » créée, mais la reprise des créneaux de « ${modele.nom} » a échoué. Vérifiez la liste des créneaux avant de compléter à la main.`,
    );
  }

  await audit("SAISON_CRENEAUX_REPRIS", {
    userId: user.id,
    cible: parsed.data.nom,
    details: `${repris} créneau(x) repris de « ${modele.nom} », ${ecartes} écarté(s)`,
  });
  revalidatePath("/parametres/saisons");
  revalidatePath("/seances");

  if (repris === 0) {
    return succes(
      `Saison « ${parsed.data.nom} » créée. Aucun créneau repris de « ${modele.nom} » : ${
        ecartes > 0
          ? "ses créneaux relèvent tous d'activités arrêtées."
          : "cette saison n'en compte aucun."
      }`,
    );
  }

  return succes(
    `Saison « ${parsed.data.nom} » créée — ${repris} ${pluriel(repris, "créneau", "créneaux")} repris de « ${modele.nom} »${
      ecartes > 0
        ? `, ${ecartes} ${pluriel(ecartes, "écarté")} (activité arrêtée)`
        : ""
    }. Vérifiez les horaires, puis déclarez les périodes de vacances.`,
  );
}

/** Active une saison — une seule à la fois : c'est elle que voient les agents. */
export async function activerSaison(id: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  await prisma.$transaction([
    prisma.saison.updateMany({ where: { active: true }, data: { active: false } }),
    prisma.saison.update({ where: { id }, data: { active: true } }),
  ]);
  await audit("SAISON_ACTIVEE", { userId: user.id, cible: id });
  revalidatePath("/parametres/saisons");
  revalidatePath("/");
}

const fermetureSchema = z.object({
  saisonId: z.string().min(1),
  libelle: z.string().trim().min(2, "Donnez un libellé (ex. « Vacances de Noël »)."),
  debut: z.string().min(1, "Date de début requise."),
  fin: z.string().min(1, "Date de fin requise."),
});

export async function ajouterFermeture(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const parsed = fermetureSchema.safeParse({
    saisonId: formData.get("saisonId"),
    libelle: formData.get("libelle"),
    debut: formData.get("debut"),
    fin: formData.get("fin"),
  });
  if (!parsed.success) return erreur(parsed.error.issues[0].message);

  const debut = jourUtc(parsed.data.debut);
  const fin = jourUtc(parsed.data.fin);
  if (fin < debut) return erreur("La fin de la période doit suivre son début.");

  await prisma.fermeture.create({
    data: { saisonId: parsed.data.saisonId, libelle: parsed.data.libelle, debut, fin },
  });

  // Les séances tombant dans la période sont retirées du calendrier — sauf
  // celles déjà émargées, que la génération préserve.
  const gen = await genererSeancesSaison(parsed.data.saisonId);
  await audit("FERMETURE_AJOUTEE", { userId: user.id, cible: parsed.data.libelle });

  revalidatePath("/parametres/saisons");
  revalidatePath("/seances");
  return succes(
    `Période ajoutée — ${gen.supprimees} séance${gen.supprimees > 1 ? "s" : ""} retirée${gen.supprimees > 1 ? "s" : ""} du calendrier.`,
  );
}

export async function supprimerFermeture(id: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const f = await prisma.fermeture.findUnique({ where: { id } });
  if (!f) return;
  await prisma.fermeture.delete({ where: { id } });
  await genererSeancesSaison(f.saisonId);
  await audit("FERMETURE_SUPPRIMEE", { userId: user.id, cible: f.libelle });
  revalidatePath("/parametres/saisons");
  revalidatePath("/seances");
}

/**
 * Supprime une saison, uniquement si aucun créneau ne s'y rattache.
 *
 * Le garde-fou est indispensable : la relation Créneau → Saison est en cascade,
 * une suppression emporterait donc séances et présences — c'est-à-dire tout
 * l'historique de fréquentation. Les périodes de fermeture, elles, ne sont que
 * des dates déclarées : elles partent sans regret.
 */
export async function supprimerSaison(id: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const saison = await prisma.saison.findUnique({
    where: { id },
    include: { _count: { select: { creneaux: true, fermetures: true } } },
  });
  if (!saison || saison._count.creneaux > 0) return;

  await prisma.saison.delete({ where: { id } });
  await audit("SAISON_SUPPRIMEE", {
    userId: user.id,
    cible: saison.nom,
    details: `${saison._count.fermetures} période(s) de fermeture supprimée(s)`,
  });
  revalidatePath("/parametres/saisons");
  revalidatePath("/");
}

export async function regenererSaison(saisonId: string): Promise<void> {
  await requireUser("GESTIONNAIRE");
  await genererSeancesSaison(saisonId);
  revalidatePath("/parametres/saisons");
  revalidatePath("/seances");
}
