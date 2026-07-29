"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import type { Jour } from "@prisma/client";
import { fmtDate, jourUtc, normaliserHeure, JOUR_LABELS } from "@/lib/dates";
import { genererSeancesCreneau } from "@/lib/seances";
import { promouvoirListeAttente } from "@/lib/inscriptions";
import { notifierChangementCreneau } from "@/lib/notifications";
import { erreur, succes, type ActionState } from "./types";

const activiteSchema = z.object({
  nom: z.string().trim().min(2, "Le nom doit comporter au moins 2 caractères."),
  description: z.string().trim().optional(),
  couleur: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide (format #rrggbb)."),
  icone: z.string().trim().min(1),
});

const capaciteSchema = z.coerce
  .number()
  .int()
  .min(1, "L'effectif du groupe doit être d'au moins 1.")
  .max(200);

export async function enregistrerActivite(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const id = String(formData.get("id") ?? "");
  const parsed = activiteSchema.safeParse({
    nom: formData.get("nom"),
    description: formData.get("description"),
    couleur: formData.get("couleur"),
    icone: formData.get("icone"),
  });
  if (!parsed.success) return erreur(parsed.error.issues[0].message);

  // Capacité mutualisée : l'activité n'ouvre qu'un groupe, réparti sur ses
  // créneaux. L'effectif devient alors obligatoire — sans lui, aucune limite ne
  // s'appliquerait plus, ni au groupe ni aux créneaux.
  const capacitePartagee = formData.get("capacitePartagee") === "on";
  let capacite: number | null = null;
  if (capacitePartagee) {
    const c = capaciteSchema.safeParse(formData.get("capacite"));
    if (!c.success) return erreur(c.error.issues[0].message);
    capacite = c.data;
  }

  const data = {
    nom: parsed.data.nom,
    description: parsed.data.description || null,
    couleur: parsed.data.couleur,
    icone: parsed.data.icone,
    capacitePartagee,
    capacite,
  };

  let creee: string | null = null;
  try {
    if (id) {
      await prisma.activite.update({ where: { id }, data });
      // L'effectif du groupe est recopié sur les créneaux de la saison en
      // cours : c'est lui qui borne désormais chaque séance, et les taux de
      // remplissage se calculent créneau par créneau. Les saisons passées
      // gardent leurs capacités d'époque, sans quoi leur historique changerait.
      if (capacitePartagee && capacite) {
        await prisma.creneau.updateMany({
          where: { activiteId: id, saison: { active: true } },
          data: { capacite },
        });
      }
      await audit("ACTIVITE_MODIFIEE", { userId: user.id, cible: data.nom });
    } else {
      const ordre = await prisma.activite.count();
      const row = await prisma.activite.create({ data: { ...data, ordre } });
      creee = row.id;
      await audit("ACTIVITE_CREEE", { userId: user.id, cible: data.nom });
    }
  } catch {
    return erreur("Une activité porte déjà ce nom.");
  }

  revalidatePath("/activites");
  if (id) revalidatePath(`/activites/${id}`);
  // Le mode de capacité change le remplissage affiché aux agents comme au
  // service des sports.
  revalidatePath("/mes-activites");
  revalidatePath("/inscriptions");

  // `redirect` lève : il doit rester hors du try, sinon le catch l'avalerait
  // et afficherait « une activité porte déjà ce nom ».
  if (creee && formData.get("redirigerVersFiche") === "1") {
    redirect(`/activites/${creee}`);
  }
  return succes(`Activité « ${data.nom} » enregistrée.`);
}

export async function basculerActivite(id: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const activite = await prisma.activite.findUnique({ where: { id } });
  if (!activite) return;
  await prisma.activite.update({ where: { id }, data: { actif: !activite.actif } });
  await audit(activite.actif ? "ACTIVITE_DESACTIVEE" : "ACTIVITE_ACTIVEE", {
    userId: user.id,
    cible: activite.nom,
  });
  revalidatePath("/activites");
}

export async function supprimerActivite(id: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const activite = await prisma.activite.findUnique({
    where: { id },
    include: { _count: { select: { creneaux: true } } },
  });
  // Une activité qui a servi n'est jamais supprimée : elle porte l'historique
  // de fréquentation. On la désactive à la place.
  if (!activite || activite._count.creneaux > 0) return;
  await prisma.activite.delete({ where: { id } });
  await audit("ACTIVITE_SUPPRIMEE", { userId: user.id, cible: activite.nom });
  revalidatePath("/activites");
}

const creneauSchema = z.object({
  saisonId: z.string().min(1, "Sélectionnez une saison."),
  activiteId: z.string().min(1, "Sélectionnez une activité."),
  jour: z.enum(["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI", "DIMANCHE"]),
  heureDebut: z.string(),
  heureFin: z.string(),
  lieu: z.string().trim().optional(),
  // Absente du formulaire quand l'activité mutualise sa capacité : c'est alors
  // l'effectif de l'activité qui s'applique.
  capacite: z.coerce
    .number()
    .int()
    .min(1, "La capacité doit être d'au moins 1.")
    .max(200)
    .optional(),
});

export async function enregistrerCreneau(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const id = String(formData.get("id") ?? "");
  const parsed = creneauSchema.safeParse({
    saisonId: formData.get("saisonId"),
    activiteId: formData.get("activiteId"),
    jour: formData.get("jour"),
    heureDebut: formData.get("heureDebut"),
    heureFin: formData.get("heureFin"),
    lieu: formData.get("lieu"),
    capacite: formData.get("capacite") ?? undefined,
  });
  if (!parsed.success) return erreur(parsed.error.issues[0].message);

  const activite = await prisma.activite.findUnique({
    where: { id: parsed.data.activiteId },
    select: { capacitePartagee: true, capacite: true },
  });
  if (!activite) return erreur("Activité introuvable.");
  // En capacité mutualisée, la limite vient de l'activité ; on recopie sa
  // valeur sur le créneau pour qu'il reste dimensionné si l'option est un jour
  // désactivée.
  const capacite = activite.capacitePartagee
    ? (activite.capacite ?? parsed.data.capacite)
    : parsed.data.capacite;
  if (capacite === undefined || capacite === null) {
    return erreur("Indiquez le nombre de places du créneau.");
  }

  const debut = normaliserHeure(parsed.data.heureDebut);
  const fin = normaliserHeure(parsed.data.heureFin);
  if (!debut || !fin) return erreur("Heures invalides (format attendu : 12:15).");
  if (fin <= debut) return erreur("L'heure de fin doit suivre l'heure de début.");

  // Bornes propres au créneau : une activité peut ne couvrir qu'une partie de
  // la saison. Vides = bornes de la saison.
  const brutDebut = String(formData.get("dateDebut") ?? "").trim();
  const brutFin = String(formData.get("dateFin") ?? "").trim();
  const dateDebut = brutDebut ? jourUtc(brutDebut) : null;
  const dateFin = brutFin ? jourUtc(brutFin) : null;
  if (dateDebut && dateFin && dateFin < dateDebut) {
    return erreur("La dernière séance doit suivre la première.");
  }

  const saison = await prisma.saison.findUnique({
    where: { id: parsed.data.saisonId },
    select: { debut: true, fin: true, nom: true },
  });
  if (!saison) return erreur("Saison introuvable.");
  // Hors saison, aucune séance ne serait générée : autant le dire tout de suite
  // plutôt que de laisser un créneau vide et inexplicable.
  if (dateDebut && (dateDebut < saison.debut || dateDebut > saison.fin)) {
    return erreur(
      `La première séance doit tomber dans la saison ${saison.nom} (${fmtDate(saison.debut)} → ${fmtDate(saison.fin)}).`,
    );
  }
  if (dateFin && (dateFin < saison.debut || dateFin > saison.fin)) {
    return erreur(
      `La dernière séance doit tomber dans la saison ${saison.nom} (${fmtDate(saison.debut)} → ${fmtDate(saison.fin)}).`,
    );
  }

  const data = {
    saisonId: parsed.data.saisonId,
    activiteId: parsed.data.activiteId,
    jour: parsed.data.jour,
    heureDebut: debut,
    heureFin: fin,
    lieu: parsed.data.lieu || null,
    capacite,
    ouvertInscription: formData.get("ouvertInscription") === "on",
    dateDebut,
    dateFin,
  };

  // Périodes de fermeture que ce créneau traverse malgré tout. `set` remplace
  // la liste entière : décocher une case doit bien retirer la dérogation.
  const animateurs = formData
    .getAll("animateurs")
    .map(String)
    .filter(Boolean)
    .map((cid) => ({ id: cid }));

  const maintenues = formData
    .getAll("fermetureMaintenue")
    .map(String)
    .filter(Boolean)
    .map((fid) => ({ id: fid }));

  // État antérieur : sert à ne prévenir les inscrits que sur ce qui a
  // réellement changé — et rien d'autre.
  const avant = id
    ? await prisma.creneau.findUnique({
        where: { id },
        select: {
          lieu: true,
          jour: true,
          heureDebut: true,
          heureFin: true,
          fermeturesMaintenues: { select: { id: true } },
        },
      })
    : null;

  const creneau = id
    ? await prisma.creneau.update({
        where: { id },
        data: {
          ...data,
          animateurs: { set: animateurs },
          fermeturesMaintenues: { set: maintenues },
        },
      })
    : await prisma.creneau.create({
        data: {
          ...data,
          animateurs: { connect: animateurs },
          fermeturesMaintenues: { connect: maintenues },
        },
      });

  // Le calendrier suit immédiatement la modification : sans cela, un créneau
  // créé n'aurait aucune séance à émarger.
  const gen = await genererSeancesCreneau(creneau.id);

  await audit(id ? "CRENEAU_MODIFIE" : "CRENEAU_CREE", {
    userId: user.id,
    cible: creneau.id,
    details: `${data.jour} ${debut}-${fin}`,
  });

  revalidatePath("/activites");
  revalidatePath(`/activites/${data.activiteId}`);
  revalidatePath("/seances");

  // Prévenir les inscrits de ce qui change leur déplacement : horaire, lieu, et
  // ouverture pendant les vacances. Ils ont organisé leur emploi du temps sur
  // les informations précédentes.
  let notification = "";
  if (avant && formData.get("prevenirInscrits") === "on") {
    const ancien = new Set(avant.fermeturesMaintenues.map((f) => f.id));
    const nouveau = new Set(maintenues.map((f) => f.id));
    const decrireQuand = (j: Jour, d: string, f: string) =>
      `${JOUR_LABELS[j].toLowerCase()} ${d}–${f}`;
    const horaireChange =
      avant.jour !== data.jour ||
      avant.heureDebut !== debut ||
      avant.heureFin !== fin;

    const res = await notifierChangementCreneau(creneau.id, {
      vacances: {
        ajoutees: [...nouveau].filter((x) => !ancien.has(x)),
        retirees: [...ancien].filter((x) => !nouveau.has(x)),
      },
      ...(avant.lieu !== data.lieu
        ? { lieu: { avant: avant.lieu, apres: data.lieu } }
        : {}),
      ...(horaireChange
        ? {
            quand: {
              avant: decrireQuand(avant.jour, avant.heureDebut, avant.heureFin),
              apres: decrireQuand(data.jour, debut, fin),
            },
          }
        : {}),
    });
    notification =
      res.envoyes > 0
        ? ` ${res.envoyes} inscrit${res.envoyes > 1 ? "s" : ""} prévenu${res.envoyes > 1 ? "s" : ""} du changement.`
        : res.destinataires > 0
          ? ` Aucun inscrit n'a pu être prévenu — vérifiez la messagerie et leurs adresses.`
          : "";
  }

  return succes(
    `Créneau enregistré — ${gen.creees} séance${gen.creees > 1 ? "s" : ""} planifiée${gen.creees > 1 ? "s" : ""}.${notification}`,
  );
}

export async function supprimerCreneau(id: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const creneau = await prisma.creneau.findUnique({
    where: { id },
    include: { seances: { where: { statut: "FAITE" }, select: { id: true } } },
  });
  // Refus si de l'émargement existe : la suppression en cascade effacerait
  // l'historique de fréquentation.
  if (!creneau || creneau.seances.length > 0) return;
  await prisma.creneau.delete({ where: { id } });
  await audit("CRENEAU_SUPPRIME", { userId: user.id, cible: id });
  revalidatePath("/activites");
}

export async function regenererCalendrier(creneauId: string): Promise<void> {
  await requireUser("GESTIONNAIRE");
  await genererSeancesCreneau(creneauId);
  revalidatePath("/activites");
  revalidatePath("/seances");
}

/** Ouvre ou ferme les inscriptions sur un créneau, et purge la file si besoin. */
export async function basculerInscriptions(creneauId: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const creneau = await prisma.creneau.findUnique({ where: { id: creneauId } });
  if (!creneau) return;
  await prisma.creneau.update({
    where: { id: creneauId },
    data: { ouvertInscription: !creneau.ouvertInscription },
  });
  if (!creneau.ouvertInscription) await promouvoirListeAttente(creneauId);
  await audit(creneau.ouvertInscription ? "CRENEAU_FERME" : "CRENEAU_OUVERT", {
    userId: user.id,
    cible: creneauId,
  });
  revalidatePath("/activites");
}
