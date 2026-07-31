import { prisma } from "./db";

/**
 * Saison courante : celle marquée active, sinon la plus récente.
 * Le repli évite un outil vide juste après l'installation, avant que le service
 * des sports n'ait activé sa première saison.
 */
export async function saisonCourante() {
  return (
    (await prisma.saison.findFirst({ where: { active: true } })) ??
    (await prisma.saison.findFirst({ orderBy: { debut: "desc" } }))
  );
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
    where: { saisonId: sourceId },
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
