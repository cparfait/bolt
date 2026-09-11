"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { aujourdhui, jourUtc } from "@/lib/dates";
import { genererSeancesSaison } from "@/lib/seances";
import { notifierSeancesAnnulees, type ResultatNotification } from "@/lib/notifications";
import {
  DUREE_MAX_SAISON_ANS,
  etatSaison,
  reprendreCreneaux,
  saisonTropLongue,
} from "@/lib/saison";
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
  // Une année de trop dans la date de fin générait des centaines de séances
  // sans que rien ne le signale — et la génération s'arrêtait en route.
  if (saisonTropLongue(debut, fin)) {
    return erreur(
      `Une saison ne peut pas dépasser ${DUREE_MAX_SAISON_ANS} ans. Vérifiez l'année de la date de fin.`,
    );
  }

  // La reprise ne vaut qu'à la création : sur une saison existante, elle
  // dupliquerait des créneaux déjà là. Le champ n'est d'ailleurs pas proposé
  // par le formulaire de modification.
  const source = id ? "" : String(formData.get("dupliquerDe") ?? "");

  // Bornes d'avant, pour savoir si la saison se raccourcit : c'est là que des
  // séances déjà notées par les inscrits vont disparaître.
  const avant = id
    ? await prisma.saison.findUnique({ where: { id }, select: { debut: true, fin: true } })
    : null;
  if (id && !avant) return erreur("Saison introuvable.");

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

  if (id && avant) {
    // Des bornes qui bougent, c'est un calendrier qui bouge : les séances
    // suivent, comme après l'ajout d'une période de fermeture. Sans cela, une
    // saison prolongée n'avait aucune séance sur ses nouvelles semaines, et
    // une saison raccourcie gardait des séances hors saison.
    //
    // Raccourcie, elle retire des séances que les inscrits ont notées : ils
    // sont prévenus AVANT la suppression — après, il n'y a plus rien à lire.
    // Même liste que ce que la génération retirera : à venir, planifiées,
    // sans présence.
    const retirees = await prisma.seance.findMany({
      where: {
        creneau: { saisonId: id, archiveAt: null },
        statut: "PLANIFIEE",
        presences: { none: {} },
        date: { gte: aujourdhui() },
        OR: [{ date: { lt: debut } }, { date: { gt: fin } }],
      },
      select: { id: true },
    });
    const prevenir = formData.get("prevenir") === "on";
    const information =
      prevenir && retirees.length > 0
        ? await notifierSeancesAnnulees(
            retirees.map((s) => s.id),
            `Modification des dates de la saison ${parsed.data.nom}`,
          )
        : null;
    const gen = await genererSeancesSaison(id);
    revalidatePath("/seances");
    revalidatePath("/mes-activites");
    const bilan = [
      gen.creees > 0 ? `${gen.creees} ${pluriel(gen.creees, "séance")} ${pluriel(gen.creees, "ajoutée")}` : null,
      gen.supprimees > 0
        ? `${gen.supprimees} ${pluriel(gen.supprimees, "retirée")} du calendrier`
        : null,
    ]
      .filter(Boolean)
      .join(", ");
    return succes(
      `Saison « ${parsed.data.nom} » enregistrée${bilan ? ` — ${bilan}` : ""}.${decrirePrevenus(information)}`,
    );
  }

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
  const saison = await prisma.saison.findUnique({
    where: { id },
    select: { active: true, debut: true, fin: true },
  });
  // Une saison close n'a plus rien à montrer : l'activer désactiverait celle
  // qui tourne et laisserait les agents devant un catalogue de l'an dernier.
  // L'écran ne propose pas le bouton ; la règle tient aussi sans l'écran.
  if (!saison || etatSaison(saison) === "close") return;
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

  // La période d'abord : tant qu'elle n'est pas écrite, rien n'est décidé, et
  // prévenir des inscrits d'une fermeture que la base refuserait ensuite
  // enverrait un courriel pour rien.
  await prisma.fermeture.create({
    data: { saisonId: parsed.data.saisonId, libelle: parsed.data.libelle, debut, fin },
  });

  // Les séances que la période va retirer, AVANT de les retirer : une
  // fermeture ajoutée en cours de saison — piscine en vidange, scrutin —
  // efface des séances que les inscrits ont notées, et pour lesquelles un
  // rappel est parfois déjà parti. Une annulation les prévient ; une
  // fermeture doit le faire aussi. La génération, elle, ne préserve que les
  // séances émargées (voir src/lib/seances.ts), donc même liste ici.
  const condamnees = await prisma.seance.findMany({
    where: {
      creneau: { saisonId: parsed.data.saisonId, archiveAt: null },
      statut: "PLANIFIEE",
      date: { gte: max(debut, aujourdhui()), lte: fin },
      presences: { none: {} },
    },
    select: { id: true },
  });
  const prevenir = formData.get("prevenir") === "on";
  const information =
    prevenir && condamnees.length > 0
      ? await notifierSeancesAnnulees(
          condamnees.map((s) => s.id),
          parsed.data.libelle,
        )
      : null;

  // Les séances tombant dans la période sont retirées du calendrier — sauf
  // celles déjà émargées, que la génération préserve.
  const gen = await genererSeancesSaison(parsed.data.saisonId);
  await audit("FERMETURE_AJOUTEE", {
    userId: user.id,
    cible: parsed.data.libelle,
    details: information ? `${information.envoyes} inscrit(s) prévenu(s)` : undefined,
  });

  revalidatePath("/parametres/saisons");
  revalidatePath("/seances");
  revalidatePath("/mes-activites");
  return succes(
    `Période ajoutée — ${gen.supprimees} séance${gen.supprimees > 1 ? "s" : ""} retirée${gen.supprimees > 1 ? "s" : ""} du calendrier.${decrirePrevenus(information)}`,
  );
}

function max(a: Date, b: Date): Date {
  return a > b ? a : b;
}

/** Fragment du compte rendu sur les inscrits prévenus, ou chaîne vide. */
function decrirePrevenus(information: ResultatNotification | null): string {
  if (!information) return "";
  if (information.envoyes > 0) {
    return ` ${information.envoyes} inscrit${information.envoyes > 1 ? "s" : ""} prévenu${information.envoyes > 1 ? "s" : ""} par courriel.`;
  }
  return information.destinataires > 0
    ? " Aucun inscrit n'a pu être prévenu — vérifiez la messagerie."
    : "";
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
