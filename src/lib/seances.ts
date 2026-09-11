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
  // Borne de sécurité, au-delà des deux ans que `enregistrerSaison` accepte
  // (104 semaines, plus un peu de marge) : une boucle qui ne s'arrêterait
  // pas ne doit jamais remplir la base. À 100, elle coupait sans le dire une
  // saison de deux ans, qui est pourtant admise.
  let garde = 0;
  while (curseur <= fin && garde++ < 160) {
    if (!estFerme(curseur, fermetures)) dates.push(curseur);
    curseur = ajouterJours(curseur, 7);
  }
  return dates;
}

export type ResultatGeneration = {
  creees: number;
  existantes: number;
  supprimees: number;
  /**
   * Ce que les séances retirées emportaient avec elles : les absences que des
   * agents avaient annoncées et les participations ponctuelles qu'on y
   * attendait. Ces lignes partent en cascade avec la séance — le compte rendu
   * doit le dire, sans quoi un changement de jour efface silencieusement des
   * engagements pris.
   */
  absencesRetirees: number;
  participationsRetirees: number;
};

const AUCUNE: ResultatGeneration = {
  creees: 0,
  existantes: 0,
  supprimees: 0,
  absencesRetirees: 0,
  participationsRetirees: 0,
};

/**
 * (Re)génère les séances d'un créneau.
 *
 * Les séances devenues hors calendrier (créneau raccourci, nouvelle période de
 * fermeture) sont supprimées **uniquement** si elles sont encore planifiées ou
 * annulées, et sans aucune présence saisie : on ne détruit jamais un
 * émargement. Une séance annulée hors calendrier n'a plus rien à dire — son
 * motif portait sur une date qui n'existe plus — et la garder la faisait
 * réapparaître, barrée, sur un jour où le créneau n'a jamais eu lieu.
 */
export async function genererSeancesCreneau(creneauId: string): Promise<ResultatGeneration> {
  const creneau = await prisma.creneau.findUnique({
    where: { id: creneauId },
    include: {
      saison: { include: { fermetures: true } },
      fermeturesMaintenues: { select: { id: true } },
    },
  });
  if (!creneau) return { ...AUCUNE };

  // Les périodes que ce créneau traverse malgré tout ne l'interrompent pas.
  const maintenues = new Set(creneau.fermeturesMaintenues.map((f) => f.id));
  const applicables = creneau.saison.fermetures.filter((f) => !maintenues.has(f.id));

  const attendues = datesDuCreneau(creneau, creneau.saison, applicables);
  const attenduesIso = new Set(attendues.map(isoDate));

  const existantes = await prisma.seance.findMany({
    where: { creneauId },
    include: { _count: { select: { presences: true, absences: true, participations: true } } },
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
      (s.statut === "PLANIFIEE" || s.statut === "ANNULEE") &&
      s._count.presences === 0,
  );
  // Comptées AVANT la suppression : elles partent en cascade avec la séance.
  const absencesRetirees = obsoletes.reduce((n, s) => n + s._count.absences, 0);
  const participationsRetirees = obsoletes.reduce((n, s) => n + s._count.participations, 0);
  if (obsoletes.length > 0) {
    await prisma.seance.deleteMany({ where: { id: { in: obsoletes.map((s) => s.id) } } });
  }

  return {
    creees: aCreer.length,
    existantes: existantes.length - obsoletes.length,
    supprimees: obsoletes.length,
    absencesRetirees,
    participationsRetirees,
  };
}

/**
 * Phrase du compte rendu pour ce que la régénération a emporté, ou chaîne
 * vide s'il n'y a rien à dire. Commence par une espace pour se coller au
 * message qui précède.
 */
export function decrirePertesGeneration(r: ResultatGeneration): string {
  const s = (n: number) => (n > 1 ? "s" : "");
  const pertes = [
    r.participationsRetirees > 0
      ? `${r.participationsRetirees} participation${s(r.participationsRetirees)} ponctuelle${s(r.participationsRetirees)}`
      : null,
    r.absencesRetirees > 0
      ? `${r.absencesRetirees} absence${s(r.absencesRetirees)} annoncée${s(r.absencesRetirees)}`
      : null,
  ].filter(Boolean);
  if (pertes.length === 0) return "";
  const total = r.participationsRetirees + r.absencesRetirees;
  return ` ${pertes.join(" et ")} retirée${s(total)} avec les séances.`;
}

/** (Re)génère les séances de tous les créneaux d'une saison. */
export async function genererSeancesSaison(saisonId: string): Promise<ResultatGeneration> {
  const creneaux = await prisma.creneau.findMany({
    where: { saisonId, archiveAt: null },
    select: { id: true },
  });
  const total = { ...AUCUNE };
  for (const c of creneaux) {
    const r = await genererSeancesCreneau(c.id);
    total.creees += r.creees;
    total.existantes += r.existantes;
    total.supprimees += r.supprimees;
    total.absencesRetirees += r.absencesRetirees;
    total.participationsRetirees += r.participationsRetirees;
  }
  return total;
}
