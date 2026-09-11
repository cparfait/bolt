"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import type { Jour } from "@prisma/client";
import { aujourdhui, fmtDate, jourUtc, normaliserHeure, JOUR_LABELS } from "@/lib/dates";
import { decrirePertesGeneration, genererSeancesCreneau } from "@/lib/seances";
import { saisonDeTravail, saisonOuverte } from "@/lib/saison";
import { promouvoirTantQuePossible, renumeroterFile } from "@/lib/inscriptions";
import { decrireNotificationOuverture, notifierOuverture } from "@/lib/alertes-ouverture";
import { notifierChangementCreneau } from "@/lib/notifications";
import { erreur, succes, type ActionState } from "./types";

const activiteSchema = z.object({
  nom: z.string().trim().min(2, "Le nom doit comporter au moins 2 caractères."),
  description: z.string().trim().optional(),
  couleur: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide (format #rrggbb)."),
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
    capacitePartagee,
    capacite,
    // Coché par défaut à la création : la quasi-totalité des activités sont
    // émargées, et l'exception doit être un geste conscient.
    suiviPresence: formData.get("suiviPresence") === "on",
  };

  let creee: string | null = null;
  // Ce que la bascule de capacité a laissé à signaler : un groupe qui compte
  // déjà plus d'inscrits que de places.
  let surEffectif = "";
  try {
    if (id) {
      await prisma.activite.update({ where: { id }, data });
      // L'effectif du groupe est recopié sur les créneaux de la saison
      // AFFICHÉE — celle que le formulaire porte —, pas sur la courante : en
      // préparant la rentrée, le service modifie l'activité depuis la saison
      // suivante, et c'est là que ses créneaux doivent suivre. Les autres
      // saisons gardent leurs capacités d'époque, sans quoi leur historique
      // changerait. Repli sur la courante si le formulaire ne dit rien.
      const saison = await saisonDeTravail(String(formData.get("saisonId") ?? "") || undefined);
      if (capacitePartagee && capacite && saison) {
        await prisma.creneau.updateMany({
          where: { activiteId: id, saisonId: saison.id },
          data: { capacite },
        });
      }
      await audit("ACTIVITE_MODIFIEE", { userId: user.id, cible: data.nom });
      const creneaux = await prisma.creneau.findMany({
        where: { activiteId: id, saisonId: saison?.id, archiveAt: null },
        select: { id: true },
        orderBy: [{ jour: "asc" }, { heureDebut: "asc" }],
      });
      // Un groupe agrandi a des places à donner : la file n'attendait sinon
      // que le prochain désistement, une personne à la fois. Sans effet si
      // rien ne s'est libéré.
      if (creneaux.length > 0) await promouvoirTantQuePossible(creneaux[0].id);
      // Le périmètre de la file a changé : deux files par créneau deviennent
      // une file commune, ou l'inverse. Les rangs de l'ancienne organisation
      // — deux « n° 1 » dans la même file, ou une file à trous — ne veulent
      // plus rien dire pour l'agent qui lit sa position.
      for (const c of creneaux) await renumeroterFile(c.id);
      // Deux créneaux de dix passés à un groupe de dix : les vingt inscrits
      // restent inscrits, rien ne les retire. Le service doit le savoir tout
      // de suite, pas en découvrant une jauge à 200 %.
      if (capacitePartagee && capacite && creneaux.length > 0) {
        const distincts = await prisma.inscription.findMany({
          where: { statut: "VALIDEE", creneauId: { in: creneaux.map((c) => c.id) } },
          select: { userId: true },
          distinct: ["userId"],
        });
        if (distincts.length > capacite) {
          surEffectif = ` Attention : ${distincts.length} agents inscrits pour ${capacite} places — le groupe est en sur-effectif, personne n'a été retiré.`;
        }
      }
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
  return succes(`Activité « ${data.nom} » enregistrée.${surEffectif}`);
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

/**
 * Retire une activité du service.
 *
 * Deux issues, et le service des sports n'a pas à choisir entre elles : c'est
 * l'historique qui tranche. Une activité qui n'a jamais eu de créneau n'a rien
 * à conserver, elle est effacée. Dès qu'un créneau existe, la supprimer
 * emporterait en cascade ses séances et ses présences — le bilan d'une saison
 * close changerait rétroactivement, et personne ne saurait pourquoi les totaux
 * ne correspondent plus à ce qui a été présenté en comité social. Elle est
 * alors archivée : elle disparaît des écrans de gestion et du catalogue des
 * agents, ses chiffres restent dans les statistiques, et le geste se défait.
 */
export async function supprimerActivite(id: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const activite = await prisma.activite.findUnique({
    where: { id },
    include: { _count: { select: { creneaux: true } } },
  });
  if (!activite) return;

  if (activite._count.creneaux === 0) {
    await prisma.activite.delete({ where: { id } });
    await audit("ACTIVITE_SUPPRIMEE", { userId: user.id, cible: activite.nom });
  } else {
    const creneaux = await prisma.creneau.findMany({
      where: { activiteId: id, archiveAt: null },
      select: { id: true },
    });
    // Les créneaux suivent : une activité archivée dont les créneaux
    // resteraient au planning continuerait d'appeler des animateurs et
    // d'accepter des inscriptions.
    //
    // Un seul horodatage pour l'activité et ses créneaux : c'est lui que
    // `restaurerActivite` compare, et chaque `new Date()` séparé d'un aller-
    // retour en base en donnait un différent — aucun créneau ne revenait.
    const quand = new Date();
    for (const c of creneaux) await archiverCreneau(c.id, quand);
    await prisma.activite.update({
      where: { id },
      data: { archiveAt: quand, actif: false },
    });
    await audit("ACTIVITE_ARCHIVEE", {
      userId: user.id,
      cible: activite.nom,
      details: `${creneaux.length} créneau(x) archivé(s) — historique conservé`,
    });
  }
  // L'activité touche le catalogue, le planning, les inscriptions et la
  // navigation : on invalide tout l'arbre plutôt que d'énumérer des chemins
  // qu'on finirait par oublier de tenir à jour.
  revalidatePath("/", "layout");
  // Le geste part de la fiche de l'activité : y rester laisserait à l'écran une
  // page qui ne décrit plus rien — supprimée, elle n'existe plus ; archivée,
  // elle n'a plus de créneau. C'est ce qui obligeait à recharger à la main.
  redirect("/activites");
}

/** Remet une activité archivée en service, avec ses créneaux. */
export async function restaurerActivite(id: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const activite = await prisma.activite.findUnique({ where: { id } });
  if (!activite?.archiveAt) return;
  const archivee = activite.archiveAt;

  await prisma.activite.update({
    where: { id },
    data: { archiveAt: null, actif: true },
  });
  // Seuls les créneaux archivés EN MÊME TEMPS qu'elle reviennent : un créneau
  // retiré trois mois plus tôt l'a été pour sa propre raison, et le ressusciter
  // au passage remettrait au planning une séance que personne n'attend.
  const revenus = await prisma.creneau.findMany({
    where: { activiteId: id, archiveAt: archivee },
    select: { id: true },
  });
  await prisma.creneau.updateMany({
    where: { id: { in: revenus.map((c) => c.id) } },
    data: { archiveAt: null },
  });
  // Comme `restaurerCreneau` : un créneau revenu au planning sans ses séances
  // à venir n'aurait rien à émarger.
  for (const c of revenus) await genererSeancesCreneau(c.id);
  await audit("ACTIVITE_RESTAUREE", {
    userId: user.id,
    cible: activite.nom,
    details: `${revenus.length} créneau(x) restauré(s)`,
  });
  revalidatePath("/", "layout");
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
          ouvertInscription: true,
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
  // Une capacité relevée libère des places d'un coup : la file avance autant
  // qu'elle le peut, pas d'une seule personne au prochain désistement.
  const promotions = id ? await promouvoirTantQuePossible(creneau.id) : "";
  // Inscriptions rouvertes par le formulaire : ceux qui attendaient l'ouverture
  // sont prévenus, comme depuis le bouton Ouvrir de la fiche.
  const ouverture =
    avant && !avant.ouvertInscription && data.ouvertInscription
      ? decrireNotificationOuverture(await notifierOuverture(creneau.id))
      : "";

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

  // Le bilan porte sur l'état du calendrier, pas sur le seul delta : après un
  // ré-enregistrement sans changement, « 0 séance planifiée » se lisait comme
  // un échec alors que toutes les séances existaient déjà.
  const s = (n: number) => (n > 1 ? "s" : "");
  const total = gen.creees + gen.existantes;
  let calendrier: string;
  if (total === 0) {
    calendrier =
      "aucune séance sur cette période — vérifiez les dates et les périodes de fermeture";
  } else if (gen.creees === 0 && gen.supprimees === 0) {
    calendrier = `calendrier inchangé, ${total} séance${s(total)} planifiée${s(total)}`;
  } else {
    const delta = [
      gen.creees > 0 ? `${gen.creees} séance${s(gen.creees)} ajoutée${s(gen.creees)}` : null,
      gen.supprimees > 0 ? `${gen.supprimees} retirée${s(gen.supprimees)}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    calendrier = `${delta} — ${total} séance${s(total)} au calendrier`;
  }
  // Un changement de jour retire les séances de l'ancien jour, et avec elles
  // les absences annoncées et les participations ponctuelles qu'elles
  // portaient : le service doit savoir qu'un engagement pris a disparu.
  return succes(
    `Créneau enregistré — ${calendrier}.${decrirePertesGeneration(gen)}${notification}${promotions}${ouverture}`,
  );
}

/**
 * Retire un créneau du planning.
 *
 * Comme pour l'activité : effacé s'il n'a rien laissé, archivé sinon. La
 * frontière est l'émargement — une séance faite, ou une présence saisie sur
 * une séance qui ne l'était pas encore. C'est la seule chose que la cascade
 * détruirait sans retour, et c'est de là que sortent les statistiques de
 * fréquentation.
 */
export async function supprimerCreneau(id: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const creneau = await prisma.creneau.findUnique({
    where: { id },
    include: {
      activite: { select: { nom: true } },
      _count: {
        select: {
          seances: { where: { OR: [{ statut: "FAITE" }, { presences: { some: {} } }] } },
          inscriptions: { where: { statut: { in: ["VALIDEE", "EN_ATTENTE", "LISTE_ATTENTE"] } } },
        },
      },
    },
  });
  if (!creneau) return;

  const intitule = `${creneau.activite.nom} — ${JOUR_LABELS[creneau.jour].toLowerCase()} ${creneau.heureDebut}`;
  if (creneau._count.seances === 0 && creneau._count.inscriptions === 0) {
    await prisma.creneau.delete({ where: { id } });
    await audit("CRENEAU_SUPPRIME", { userId: user.id, cible: intitule });
  } else {
    // « Jamais émargé » ne veut pas dire « sans engagement » : un créneau de
    // septembre avec quinze inscrits dont la première séance est la semaine
    // prochaine partait en cascade, inscriptions comprises, sans un mot. Dès
    // qu'un dossier vivant existe, on archive — les inscrits restent visibles
    // sur leur fiche, et le geste se défait.
    const retirees = await archiverCreneau(id);
    await audit("CRENEAU_ARCHIVE", {
      userId: user.id,
      cible: intitule,
      details: `${retirees} séance(s) à venir retirée(s) — historique conservé`,
    });
  }
  // Y compris la fiche de l'activité, d'où part le geste : `revalidatePath`
  // sur une route dynamique ne rafraîchit pas la page affichée, et le créneau
  // restait à l'écran jusqu'à un rechargement manuel.
  revalidatePath("/", "layout");
}

/**
 * Archive un créneau et nettoie ce qui n'a pas encore eu lieu.
 *
 * Les séances à venir sont retirées — elles n'auront pas lieu, et les laisser
 * réclamerait des feuilles d'émargement pour un créneau qui n'existe plus.
 * Celles qui portent déjà une présence ne sont jamais touchées, même à venir :
 * quelqu'un y a été pointé, c'est un fait constaté. Les inscriptions, elles,
 * restent en place : ce sont elles qui disent combien d'agents la saison a
 * touchés, et les désister ferait varier le bilan après coup.
 *
 * Renvoie le nombre de séances retirées du calendrier.
 */
async function archiverCreneau(id: string, quand: Date = new Date()): Promise<number> {
  const retirees = await prisma.seance.deleteMany({
    where: {
      creneauId: id,
      statut: "PLANIFIEE",
      date: { gte: aujourdhui() },
      presences: { none: {} },
    },
  });
  // Les demandes et les attentes, elles, n'ont aucune valeur pour le bilan :
  // laissées en place, elles comptaient dans le plafond d'attente de l'agent
  // sans qu'aucun écran ne lui permette d'en sortir, et n'étaient plus jamais
  // promues. Les inscriptions validées restent, pour la fréquentation.
  await prisma.inscription.updateMany({
    where: { creneauId: id, statut: { in: ["EN_ATTENTE", "LISTE_ATTENTE"] } },
    data: {
      statut: "DESISTEE",
      rang: null,
      decisionAt: quand,
      decidePar: "créneau retiré",
      motif: "Créneau retiré du planning",
    },
  });
  // Les demandes d'alerte n'ont plus d'ouverture à attendre : un créneau
  // retiré ne rouvre pas. Les laisser promettait un courriel qui ne
  // partirait jamais — ou partirait à tort si le créneau était restauré et
  // rouvert une saison plus tard.
  await prisma.alerteOuverture.deleteMany({ where: { creneauId: id } });
  await prisma.creneau.update({
    where: { id },
    data: { archiveAt: quand, ouvertInscription: false },
  });
  return retirees.count;
}

/** Remet au planning un créneau archivé. Les séances se regénèrent. */
export async function restaurerCreneau(id: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const creneau = await prisma.creneau.findUnique({
    where: { id },
    include: { activite: { select: { nom: true, archiveAt: true } } },
  });
  if (!creneau?.archiveAt) return;
  // Une activité archivée ne peut pas héberger un créneau vivant : c'est elle
  // qu'il faut restaurer d'abord, et ses créneaux suivront.
  if (creneau.activite.archiveAt) return;

  await prisma.creneau.update({ where: { id }, data: { archiveAt: null } });
  await genererSeancesCreneau(id);
  await audit("CRENEAU_RESTAURE", {
    userId: user.id,
    cible: `${creneau.activite.nom} — ${JOUR_LABELS[creneau.jour].toLowerCase()} ${creneau.heureDebut}`,
  });
  revalidatePath("/", "layout");
}

export async function regenererCalendrier(creneauId: string): Promise<void> {
  await requireUser("GESTIONNAIRE");
  await genererSeancesCreneau(creneauId);
  revalidatePath("/activites");
  revalidatePath("/seances");
}

/**
 * Ouvre ou ferme les inscriptions sur un créneau ; à la réouverture, la file
 * avance et ceux qui attendaient l'ouverture sont prévenus.
 *
 * Renvoie un état de formulaire plutôt que rien : le résultat de l'envoi des
 * alertes — « 3 agents prévenus », « aucun courriel n'a pu partir » — est la
 * seule chose que le service ne peut pas vérifier à l'écran, et il se perdait.
 */
export async function basculerInscriptions(creneauId: string): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const creneau = await prisma.creneau.findUnique({
    where: { id: creneauId },
    include: { activite: { select: { actif: true, archiveAt: true } } },
  });
  if (!creneau) return erreur("Créneau introuvable.");
  // Un créneau retiré du planning n'accepte plus personne : le rouvrir par
  // cette porte enverrait des courriels d'ouverture vers un créneau que le
  // catalogue ne montre pas.
  if (creneau.archiveAt) return erreur("Ce créneau est retiré du planning : restaurez-le d'abord.");
  await prisma.creneau.update({
    where: { id: creneauId },
    data: { ouvertInscription: !creneau.ouvertInscription },
  });
  let ouverture = "";
  if (!creneau.ouvertInscription) {
    const promotions = await promouvoirTantQuePossible(creneauId);
    // Ceux qui avaient demandé à être prévenus le sont maintenant : c'est
    // tout l'intérêt de l'alerte, et le seul moment où elle sert — à
    // condition que l'agent puisse effectivement s'inscrire. Sur une
    // activité arrêtée ou une saison que les agents ne voient pas (en
    // préparation, ou passée), le courriel renverrait vers un créneau absent
    // du catalogue : l'alerte reste posée jusqu'à une ouverture réelle.
    const ouverte = await saisonOuverte();
    const visible =
      creneau.activite.actif && !creneau.activite.archiveAt && creneau.saisonId === ouverte?.id;
    ouverture = visible
      ? decrireNotificationOuverture(await notifierOuverture(creneauId))
      : " Les agents qui attendent l'ouverture ne sont pas prévenus : ce créneau n'est pas dans le catalogue (activité arrêtée ou saison non activée).";
    ouverture = promotions + ouverture;
  }
  await audit(creneau.ouvertInscription ? "CRENEAU_FERME" : "CRENEAU_OUVERT", {
    userId: user.id,
    cible: creneauId,
  });
  // Y compris la fiche de l'activité, d'où part le geste : comme pour
  // `supprimerCreneau`, un chemin dynamique ne se rafraîchit pas autrement.
  revalidatePath("/", "layout");
  return succes(
    creneau.ouvertInscription
      ? "Inscriptions fermées sur ce créneau."
      : `Inscriptions ouvertes.${ouverture}`,
  );
}
