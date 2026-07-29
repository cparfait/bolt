import type { Creneau, Fermeture, Saison } from "@prisma/client";
import { prisma } from "./db";
import { ajouterJours, isoDate, jourIndex, jourUtc } from "./dates";

/**
 * Génération du calendrier des séances.
 *
 * Un créneau décrit une récurrence hebdomadaire ; les séances sont les
 * occurrences datées sur lesquelles porte l'émargement. On les matérialise en
 * base plutôt que de les calculer à la volée : une séance porte un état, un
 * commentaire, une annulation et des présences — autant d'informations qui ne
 * se déduisent pas de la règle de récurrence.
 *
 * La génération est idempotente : `@@unique([creneauId, date])` et `skipDuplicates`
 * permettent de la relancer après chaque modification de calendrier sans créer
 * de doublon ni écraser un émargement déjà saisi.
 */

/** Vrai si la date tombe dans une période de fermeture (bornes incluses). */
function estFerme(date: Date, fermetures: Fermeture[]): boolean {
  const t = date.getTime();
  return fermetures.some(
    (f) => jourUtc(f.debut).getTime() <= t && t <= jourUtc(f.fin).getTime(),
  );
}

/**
 * Dates d'occurrence d'un créneau sur sa saison, hors périodes de fermeture.
 *
 * `fermetures` doit déjà être filtré des périodes que ce créneau ignore : toutes
 * les activités ne s'arrêtent pas aux vacances scolaires.
 */
export function datesDuCreneau(
  creneau: Pick<Creneau, "jour" | "dateDebut" | "dateFin">,
  saison: Pick<Saison, "debut" | "fin">,
  fermetures: Fermeture[],
): Date[] {
  const debut = jourUtc(creneau.dateDebut ?? saison.debut);
  const fin = jourUtc(creneau.dateFin ?? saison.fin);
  if (fin < debut) return [];

  // Se caler sur la première occurrence du bon jour de semaine.
  const cible = jourIndex(creneau.jour);
  let curseur = debut;
  const decalage = (cible - curseur.getUTCDay() + 7) % 7;
  curseur = ajouterJours(curseur, decalage);

  const dates: Date[] = [];
  // Borne de sécurité : une saison ne dépasse pas ~70 semaines.
  let garde = 0;
  while (curseur <= fin && garde++ < 100) {
    if (!estFerme(curseur, fermetures)) dates.push(curseur);
    curseur = ajouterJours(curseur, 7);
  }
  return dates;
}

export type ResultatGeneration = {
  creees: number;
  existantes: number;
  supprimees: number;
};

/**
 * (Re)génère les séances d'un créneau.
 *
 * Les séances devenues hors calendrier (créneau raccourci, nouvelle période de
 * fermeture) sont supprimées **uniquement** si elles sont encore planifiées et
 * sans aucune présence saisie : on ne détruit jamais un émargement.
 */
export async function genererSeancesCreneau(creneauId: string): Promise<ResultatGeneration> {
  const creneau = await prisma.creneau.findUnique({
    where: { id: creneauId },
    include: {
      saison: { include: { fermetures: true } },
      fermeturesMaintenues: { select: { id: true } },
    },
  });
  if (!creneau) return { creees: 0, existantes: 0, supprimees: 0 };

  // Les périodes que ce créneau traverse malgré tout ne l'interrompent pas.
  const maintenues = new Set(creneau.fermeturesMaintenues.map((f) => f.id));
  const applicables = creneau.saison.fermetures.filter((f) => !maintenues.has(f.id));

  const attendues = datesDuCreneau(creneau, creneau.saison, applicables);
  const attenduesIso = new Set(attendues.map(isoDate));

  const existantes = await prisma.seance.findMany({
    where: { creneauId },
    include: { _count: { select: { presences: true } } },
  });
  const existantesIso = new Set(existantes.map((s) => isoDate(s.date)));

  const aCreer = attendues.filter((d) => !existantesIso.has(isoDate(d)));
  if (aCreer.length > 0) {
    await prisma.seance.createMany({
      data: aCreer.map((date) => ({ creneauId, date })),
      skipDuplicates: true,
    });
  }

  const obsoletes = existantes.filter(
    (s) =>
      !attenduesIso.has(isoDate(s.date)) &&
      s.statut === "PLANIFIEE" &&
      s._count.presences === 0,
  );
  if (obsoletes.length > 0) {
    await prisma.seance.deleteMany({ where: { id: { in: obsoletes.map((s) => s.id) } } });
  }

  return {
    creees: aCreer.length,
    existantes: existantes.length - obsoletes.length,
    supprimees: obsoletes.length,
  };
}

/** (Re)génère les séances de tous les créneaux d'une saison. */
export async function genererSeancesSaison(saisonId: string): Promise<ResultatGeneration> {
  const creneaux = await prisma.creneau.findMany({
    where: { saisonId },
    select: { id: true },
  });
  const total = { creees: 0, existantes: 0, supprimees: 0 };
  for (const c of creneaux) {
    const r = await genererSeancesCreneau(c.id);
    total.creees += r.creees;
    total.existantes += r.existantes;
    total.supprimees += r.supprimees;
  }
  return total;
}
