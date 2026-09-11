import { prisma } from "./db";
import { aujourdhui, jourUtc } from "./dates";

/**
 * Saison courante, pour le BACK-OFFICE : celle marquée active, sinon la plus
 * récente. Le repli évite un outil vide juste après l'installation, avant que
 * le service des sports n'ait activé sa première saison — il prépare ses
 * activités et ses créneaux sur la saison qu'il vient de créer.
 *
 * Les agents, eux, passent par `saisonOuverte`.
 */
export async function saisonCourante() {
  return (
    (await prisma.saison.findFirst({ where: { active: true } })) ??
    (await prisma.saison.findFirst({ orderBy: { debut: "desc" } }))
  );
}

/**
 * Saison ouverte aux AGENTS : la saison activée, et rien d'autre.
 *
 * Pas de repli ici : activer une saison est le geste par lequel le service
 * des sports décide que le catalogue est prêt à être vu. Tant qu'il ne l'a
 * pas fait, une saison en préparation — créneaux à moitié saisis, capacités
 * provisoires — ne doit pas recevoir d'inscriptions. C'est la même règle pour
 * ce que le catalogue montre et pour ce que l'inscription accepte : l'un ne
 * doit jamais proposer ce que l'autre refuse.
 */
export async function saisonOuverte() {
  return prisma.saison.findFirst({ where: { active: true } });
}

export type RepriseCreneaux = {
  /** Créneaux effectivement recréés sur la saison cible. */
  repris: number;
  /** Créneaux de la saison source écartés parce que leur activité est arrêtée. */
  ecartes: number;
};

/**
 * Recrée sur une saison les créneaux d'une autre.
 *
 * D'une année sur l'autre, la grille bouge à la marge : le service des sports
 * reconduit le yoga du lundi midi et le basket du mercredi soir, et ajuste
 * ensuite. Tout ressaisir à la main est long et fait perdre des créneaux en
 * route — c'est la reprise qui doit être le point de départ, la correction
 * venant après.
 *
 * Ce qui est repris : l'activité, le jour, les horaires, le lieu, la capacité,
 * l'ouverture aux inscriptions et les animateurs rattachés.
 *
 * Ce qui ne l'est pas, et pourquoi :
 * — les inscriptions et les séances, qui appartiennent à l'année écoulée ;
 * — les bornes propres au créneau (`dateDebut`, `dateFin`), qui sont des dates
 *   de l'ancienne saison : les laisser vides fait suivre les bornes de la
 *   nouvelle, ce qui est le seul repli qui ne produise pas un calendrier faux ;
 * — les périodes de fermeture, calées sur le calendrier scolaire d'une année
 *   donnée. Recopier « Vacances de Noël du 20/12/2025 au 05/01/2026 » sur la
 *   saison suivante donnerait des dates fausses, sans que rien ne le signale ;
 * — les créneaux d'une activité arrêtée : la désactiver, c'est justement dire
 *   qu'on ne la propose plus. Ils sont comptés à part pour que la reprise le
 *   dise plutôt que de les escamoter ;
 * — les animateurs désactivés, pour la même raison.
 */
export async function reprendreCreneaux(
  sourceId: string,
  cibleId: string,
): Promise<RepriseCreneaux> {
  const creneaux = await prisma.creneau.findMany({
    where: { saisonId: sourceId, archiveAt: null },
    include: {
      activite: { select: { actif: true } },
      animateurs: { where: { actif: true }, select: { id: true } },
    },
    orderBy: [{ activiteId: "asc" }, { jour: "asc" }, { heureDebut: "asc" }],
  });

  const aReprendre = creneaux.filter((c) => c.activite.actif);

  // Créations une à une plutôt qu'un `createMany` : le rattachement des
  // animateurs est une relation N-N, que `createMany` ne sait pas écrire.
  for (const c of aReprendre) {
    await prisma.creneau.create({
      data: {
        saisonId: cibleId,
        activiteId: c.activiteId,
        jour: c.jour,
        heureDebut: c.heureDebut,
        heureFin: c.heureFin,
        lieu: c.lieu,
        capacite: c.capacite,
        ouvertInscription: c.ouvertInscription,
        animateurs: { connect: c.animateurs.map((a) => ({ id: a.id })) },
      },
    });
  }

  return { repris: aReprendre.length, ecartes: creneaux.length - aReprendre.length };
}

/**
 * Saison sur laquelle le service travaille : celle demandée par l'écran
 * (`?saison=…`), sinon la courante.
 *
 * C'est ce qui permet de préparer la saison suivante — activités, créneaux,
 * périodes de fermeture — pendant que l'actuelle tourne : les agents ne
 * voient que la saison activée (`saisonOuverte`), le service voit celle
 * qu'il choisit. Un identifiant inconnu retombe sur la courante plutôt que
 * de produire une page vide.
 */
export async function saisonDeTravail(saisonId?: string) {
  if (saisonId) {
    const demandee = await prisma.saison.findUnique({ where: { id: saisonId } });
    if (demandee) return demandee;
  }
  return saisonCourante();
}

/**
 * Les saisons offertes au sélecteur des écrans du service, de la plus
 * récente à la plus ancienne, avec juste ce qu'il faut pour les nommer et
 * dire leur état.
 */
export async function saisonsProposees() {
  return prisma.saison.findMany({
    orderBy: { debut: "desc" },
    select: { id: true, nom: true, active: true, debut: true, fin: true },
  });
}

/**
 * Ce qu'une saison est pour le service :
 *  — `active` : activée, c'est elle que voient les agents ;
 *  — `preparation` : pas encore commencée, invisible des agents ;
 *  — `encours` : commencée mais jamais activée — le service a oublié le
 *    bouton, ou une autre saison est restée active à sa place. Les agents ne
 *    la voient pas non plus, mais ce n'est plus « en préparation » : des
 *    séances ont lieu ;
 *  — `close` : son dernier jour est passé.
 */
export type EtatSaison = "active" | "preparation" | "encours" | "close";

/** Ce qu'une saison est pour le service, au regard de la date et du drapeau. */
export function etatSaison(
  s: { active: boolean; debut: Date; fin: Date },
  // Jour calendaire, pas instant : `fin` est stockée à minuit UTC, et la
  // comparer à `new Date()` fermait la saison dès le matin de son dernier
  // jour — alors que la séance du soir a encore lieu.
  aujourdHui: Date = aujourdhui(),
): EtatSaison {
  if (s.active) return "active";
  const jour = jourUtc(aujourdHui);
  if (jourUtc(s.fin) < jour) return "close";
  return jourUtc(s.debut) <= jour ? "encours" : "preparation";
}

/** Libellés des états, partagés par le sélecteur et l'écran des saisons. */
export const LIBELLES_ETAT_SAISON: Record<EtatSaison, string> = {
  active: "en cours",
  preparation: "en préparation",
  encours: "en cours, non affichée aux agents",
  close: "close",
};

/**
 * Durée maximale d'une saison, en années. Une saison sportive dure un an ;
 * deux ans laissent la place à une saison à cheval ou décalée, pas à une
 * faute de frappe sur l'année qui générerait des centaines de séances.
 */
export const DUREE_MAX_SAISON_ANS = 2;

/** Vrai si la saison dépasse la durée maximale admise. */
export function saisonTropLongue(debut: Date, fin: Date): boolean {
  const limite = new Date(debut);
  limite.setUTCFullYear(limite.getUTCFullYear() + DUREE_MAX_SAISON_ANS);
  return jourUtc(fin) > limite;
}
