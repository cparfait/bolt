import type { EtatPresence, InscriptionStatut, Jour } from "@prisma/client";
import { prisma } from "./db";
import {
  aujourdhui,
  cleMois,
  debutMois,
  fmtMois,
  fmtMoisCourt,
  isoDate,
  jourIndex,
} from "./dates";
import { adresseDeContact } from "./comptes";
import { participeALaSeance } from "./inscriptions";
import { feuillesAttendues } from "./emargement";
import {
  cleComparaison,
  reglesDeRegroupement,
  resoudreService,
  servicesProposes,
} from "./services";

/**
 * Statistiques de fréquentation — la finalité de l'outil côté QVT.
 *
 * Les volumes sont modestes (une saison ≈ 5 activités × 35 séances × 25 agents,
 * soit quelques milliers de lignes) : on charge la saison et on agrège en
 * mémoire. C'est plus lisible qu'un empilement de `groupBy` Prisma, et cela
 * permet des indicateurs croisés (activité × mois × direction) sans multiplier
 * les allers-retours en base.
 *
 * Les agrégats sont des fonctions pures sur des tableaux de séances (`agreger…`),
 * séparées du chargement : c'est ce qui permet de les tester sans base, et de
 * charger la saison une seule fois pour tout un bilan (voir `SeanceChargee`).
 *
 * Formules — les mêmes à l'écran, dans le classeur et dans le CSV :
 *
 *  • **attendus à une séance** = inscrits validés dont l'inscription couvre la
 *    date (entrée ≤ date, et date < sortie pour un désistement), plus les
 *    lignes de présence hors inscription — les participants ponctuels pointés ;
 *  • **taux de présence** = présents / attendus. Une ligne ABSENT, ou l'absence
 *    de ligne pour un attendu, compte comme une absence. Rapporter les présents
 *    aux seules lignes pointées, comme avant, affichait 100 % dès qu'un
 *    animateur ne pointait que ceux qui venaient ;
 *  • **places offertes** = capacité du créneau (ou, en capacité mutualisée, les
 *    attendus de la séance) + ponctuels pointés, pour que le remplissage ne
 *    dépasse jamais 100 % ;
 *  • **taux de feuilles remplies** = séances émargées / feuilles attendues, aux
 *    règles de l'alerte du tableau de bord (`feuillesAttendues`), sans sa
 *    fenêtre de soixante jours et jusqu'à la veille ;
 *  • **taux d'annulation** = annulées / (séances déjà passées ou annulées) ;
 *  • **assiduité** = présences / séances émargées proposées à l'inscrit depuis
 *    son entrée sur le créneau.
 */

export type Filtre = {
  saisonId: string;
  activiteId?: string;
  du?: Date;
  au?: Date;
};

export function estPresent(etat: EtatPresence): boolean {
  return etat === "PRESENT";
}

// ── Une séance, vue par le bilan ───────────────────────────────────────────

export type InscriptionPourPlaces = {
  /** Absent des jeux de test historiques : le comptage s'en passe. */
  userId?: string;
  statut: string;
  decisionAt: Date | null;
  demandeAt: Date;
  promuAt?: Date | null;
};

export type PresencePourBilan = { userId: string; etat: EtatPresence };

export type SeanceSansPresences = {
  date: Date;
  creneau: {
    capacite: number;
    activite: { capacitePartagee: boolean; capacite: number | null };
    inscriptions?: InscriptionPourPlaces[];
  };
};

export type SeancePourBilan = SeanceSansPresences & { presences?: PresencePourBilan[] };

/**
 * Vrai si cette inscription faisait attendre l'agent à la séance de ce jour.
 *
 * Validée : depuis son entrée sur le créneau (`participeALaSeance`). Désistée :
 * entre l'entrée et la sortie — l'agent qui a quitté l'activité en janvier était
 * bien attendu en octobre, et l'oublier ferait remonter après coup la présence
 * des séances d'automne. Pour un désistement, `decisionAt` a été réécrit par le
 * désistement lui-même et vaut donc la sortie ; l'entrée est la promotion depuis
 * la file quand il y en a eu une, sinon la demande. C'est une approximation —
 * la date de validation n'a pas été conservée — qui compte quelques séances de
 * trop à qui a attendu son arbitrage, jamais de séance en moins.
 */
export function attenduA(i: InscriptionPourPlaces, date: Date): boolean {
  if (i.statut === "VALIDEE") return participeALaSeance(i, date);
  if (i.statut === "DESISTEE") {
    if (!i.decisionAt) return false;
    const jour = isoDate(date);
    return isoDate(i.promuAt ?? i.demandeAt) <= jour && jour < isoDate(i.decisionAt);
  }
  return false;
}

/** Les inscriptions qui attendaient quelqu'un à cette séance. */
export function inscritsAttendus(s: SeanceSansPresences): InscriptionPourPlaces[] {
  return (s.creneau.inscriptions ?? []).filter((i) => attenduA(i, s.date));
}

/**
 * Lignes de présence de personnes que le créneau n'attendait pas ce jour-là :
 * participants ponctuels, agent venu avant son inscription. Elles comptent au
 * dénominateur comme au numérateur — sans quoi un ponctuel présent gonflait
 * le taux au-delà de 100 %.
 */
export function presencesHorsInscription<P extends { userId: string }>(
  s: SeanceSansPresences & { presences?: P[] },
): P[] {
  const attendus = new Set(
    inscritsAttendus(s)
      .map((i) => i.userId)
      .filter((id): id is string => Boolean(id)),
  );
  return (s.presences ?? []).filter((p) => !attendus.has(p.userId));
}

/**
 * Places offertes par une séance — le dénominateur du taux de remplissage.
 *
 * Capacité par créneau : c'est la capacité du créneau.
 *
 * Capacité mutualisée : le groupe compte douze agents répartis sur le lundi et
 * le jeudi, mais aucune séance n'en attend douze. Rapporter les présents du
 * lundi à l'effectif du groupe plafonnait mécaniquement le remplissage vers
 * 50 % pour une activité pleine, et le bilan lisait « sous-utilisée » une
 * activité qui refusait du monde. Le remplissage se mesure donc séance par
 * séance, contre ce que la séance attendait réellement : les inscrits de ce
 * créneau-là, à cette date-là — désistés depuis compris.
 *
 * Dans les deux cas, les ponctuels pointés s'ajoutent : ils occupent une place
 * que le planning n'offrait pas, et sans eux une séance pleine plus un invité
 * affichait 110 %.
 */
export function placesOffertes(s: SeancePourBilan): number {
  const a = s.creneau.activite;
  const ponctuels = presencesHorsInscription(s).length;
  if (!a.capacitePartagee) return s.creneau.capacite + ponctuels;
  const attendus = inscritsAttendus(s).length;
  // Sans inscrits chargés — ou sans inscrit du tout —, on retombe sur
  // l'effectif du groupe plutôt que sur zéro, qui ferait disparaître la ligne.
  return (attendus > 0 ? attendus : (a.capacite ?? s.creneau.capacite)) + ponctuels;
}

export type BilanSeance = {
  presents: number;
  /** Inscrits attendus ce jour-là + lignes hors inscription. */
  attendus: number;
  /** Attendus non venus : pointés absents ou sans ligne. */
  absents: number;
};

/** Présents, attendus et absents d'une séance, selon la formule de tête. */
export function bilanSeance(s: SeancePourBilan): BilanSeance {
  const attendus = inscritsAttendus(s).length + presencesHorsInscription(s).length;
  const presents = (s.presences ?? []).filter((p) => estPresent(p.etat)).length;
  return { presents, attendus, absents: Math.max(0, attendus - presents) };
}

/** Inscriptions utiles à `placesOffertes` et `bilanSeance`, sous `creneau`. */
export const INSCRIPTIONS_POUR_PLACES = {
  where: { statut: { in: ["VALIDEE", "DESISTEE"] as InscriptionStatut[] } },
  select: { userId: true, statut: true, decisionAt: true, demandeAt: true, promuAt: true },
};

/**
 * Ce que le bilan a besoin de savoir d'un agent — et rien de plus. Un `include`
 * complet embarquait le hachage du mot de passe dans chaque ligne de présence.
 */
export const UTILISATEUR_POUR_STATS = {
  select: {
    id: true,
    displayName: true,
    direction: true,
    service: true,
    active: true,
    login: true,
  },
};

export async function chargerSeances(f: Filtre) {
  return prisma.seance.findMany({
    where: {
      creneau: {
        saisonId: f.saisonId,
        ...(f.activiteId ? { activiteId: f.activiteId } : {}),
      },
      ...(f.du || f.au
        ? { date: { ...(f.du ? { gte: f.du } : {}), ...(f.au ? { lte: f.au } : {}) } }
        : {}),
    },
    include: {
      creneau: { include: { activite: true, inscriptions: INSCRIPTIONS_POUR_PLACES } },
      presences: { select: { userId: true, etat: true, user: UTILISATEUR_POUR_STATS } },
    },
    orderBy: { date: "asc" },
  });
}

/**
 * Une séance telle que `chargerSeances` la rend. Chaque indicateur accepte un
 * tableau déjà chargé en second argument : un bilan complet en appelait six
 * fois de suite pour relire six fois la même saison.
 */
export type SeanceChargee = Awaited<ReturnType<typeof chargerSeances>>[number];

async function seancesDe(f: Filtre, deja?: SeanceChargee[]): Promise<SeanceChargee[]> {
  return deja ?? chargerSeances(f);
}

/** Motif d'annulation tel qu'on le regroupe — une seule graphie pour « rien ». */
export const MOTIF_NON_RENSEIGNE = "Motif non renseigné";

export function motifNormalise(motif: string | null | undefined): string {
  return motif?.trim() || MOTIF_NON_RENSEIGNE;
}

/**
 * Pourcentages entiers qui somment à 100.
 *
 * Arrondir chaque part séparément donne 33 + 33 + 33 = 99, ou 101, et un
 * lecteur de comité social le remarque avant tout le reste. La plus grande
 * part se déduit des autres par différence : c'est là que l'écart d'arrondi se
 * voit le moins, et elle est assez large pour l'absorber sans passer sous zéro.
 */
export function repartirEnParts(valeurs: number[]): number[] {
  const total = valeurs.reduce((a, b) => a + b, 0);
  if (total <= 0) return valeurs.map(() => 0);
  const parts = valeurs.map((v) => Math.round((v / total) * 100));
  const principale = valeurs.indexOf(Math.max(...valeurs));
  const autres = parts.reduce((somme, p, i) => (i === principale ? somme : somme + p), 0);
  parts[principale] = 100 - autres;
  return parts;
}

// ── Indicateurs de tête ────────────────────────────────────────────────────

export type Indicateurs = {
  seancesTotal: number;
  seancesEmargees: number;
  seancesAnnulees: number;
  seancesPassees: number; // passées, non annulées, avec une feuille attendue
  seancesSansEmargement: number; // passées, non annulées, sans feuille attendue
  tauxEmargement: number; // séances émargées / feuilles attendues
  presents: number;
  absents: number; // attendus non venus
  tauxPresence: number; // présents / attendus
  frequentationMoyenne: number; // présents par séance émargée
  inscrits: number; // inscriptions validées distinctes, à ce jour
  agentsUniques: number; // agents ayant participé au moins une fois
  capacite: number; // somme des places offertes × séances émargées
  tauxRemplissage: number;
};

type SeancePourAgregat = SeancePourBilan & {
  id: string;
  statut: string;
  presences: PresencePourBilan[];
};

/**
 * Les indicateurs de tête, sur des séances en mémoire.
 *
 * `feuillesAttenduesIds` vient de `feuillesAttendues` (src/lib/emargement.ts) :
 * ce sont les mêmes règles que l'alerte du tableau de bord — activité pointée,
 * créneau non archivé, quelqu'un d'attendu ou déjà pointé —, sans quoi le
 * bilan reprochait des feuilles que le tableau de bord ne réclamait pas.
 */
export function agregerIndicateurs(
  seances: SeancePourAgregat[],
  feuillesAttenduesIds: Set<string>,
  inscrits: number,
  today: Date = aujourdhui(),
): Indicateurs {
  let presents = 0;
  let absents = 0;
  let capacite = 0;
  const agents = new Set<string>();

  const emargees = seances.filter((s) => s.statut === "FAITE");
  const annulees = seances.filter((s) => s.statut === "ANNULEE").length;

  // Jusqu'à la veille : une séance du soir n'est pas en retard à midi.
  const revolues = seances.filter((s) => s.date < today && s.statut !== "ANNULEE");
  const attendues = revolues.filter((s) => feuillesAttenduesIds.has(s.id));
  const remplies = attendues.filter((s) => s.statut === "FAITE").length;

  for (const s of emargees) {
    capacite += placesOffertes(s);
    const b = bilanSeance(s);
    presents += b.presents;
    absents += b.absents;
    for (const p of s.presences) if (estPresent(p.etat)) agents.add(p.userId);
  }

  return {
    seancesTotal: seances.length,
    seancesEmargees: emargees.length,
    seancesAnnulees: annulees,
    seancesPassees: attendues.length,
    seancesSansEmargement: revolues.length - attendues.length,
    tauxEmargement: attendues.length > 0 ? Math.round((remplies / attendues.length) * 100) : 0,
    presents,
    absents,
    tauxPresence:
      presents + absents > 0 ? Math.round((presents / (presents + absents)) * 100) : 0,
    frequentationMoyenne:
      emargees.length > 0 ? Math.round((presents / emargees.length) * 10) / 10 : 0,
    inscrits,
    agentsUniques: agents.size,
    capacite,
    tauxRemplissage: capacite > 0 ? Math.round((presents / capacite) * 100) : 0,
  };
}

export async function indicateurs(f: Filtre, deja?: SeanceChargee[]): Promise<Indicateurs> {
  const [seances, inscriptions] = await Promise.all([
    seancesDe(f, deja),
    prisma.inscription.findMany({
      where: {
        statut: "VALIDEE",
        creneau: {
          saisonId: f.saisonId,
          ...(f.activiteId ? { activiteId: f.activiteId } : {}),
        },
      },
      select: { userId: true },
    }),
  ]);
  const today = aujourdhui();
  const attendues = await feuillesAttendues(
    seances.filter((s) => s.date < today && s.statut !== "ANNULEE"),
  );
  return agregerIndicateurs(
    seances,
    new Set(attendues.map((s) => s.id)),
    new Set(inscriptions.map((i) => i.userId)).size,
    today,
  );
}

// ── Par activité ───────────────────────────────────────────────────────────

export type LigneActivite = {
  activiteId: string;
  nom: string;
  couleur: string;
  /** Faux : les colonnes de présence n'ont pas de sens pour cette activité. */
  suiviPresence: boolean;
  seancesEmargees: number;
  presents: number;
  absents: number; // attendus non venus
  inscrits: number;
  capacite: number;
  moyenne: number;
  tauxPresence: number; // présents / attendus
  tauxRemplissage: number;
};

export function agregerParActivite(
  seances: (SeancePourAgregat & {
    creneau: { activite: { id: string; nom: string; couleur: string; suiviPresence: boolean } };
  })[],
  inscriptions: { userId: string; activiteId: string }[],
): LigneActivite[] {
  type Acc = Omit<LigneActivite, "moyenne" | "tauxPresence" | "tauxRemplissage" | "inscrits"> & {
    inscrits: Set<string>;
  };
  const acc = new Map<string, Acc>();

  for (const s of seances) {
    const a = s.creneau.activite;
    if (!acc.has(a.id)) {
      acc.set(a.id, {
        activiteId: a.id,
        nom: a.nom,
        couleur: a.couleur,
        suiviPresence: a.suiviPresence,
        seancesEmargees: 0,
        presents: 0,
        absents: 0,
        capacite: 0,
        inscrits: new Set(),
      });
    }
    const row = acc.get(a.id)!;
    if (s.statut !== "FAITE") continue;
    row.seancesEmargees += 1;
    row.capacite += placesOffertes(s);
    const b = bilanSeance(s);
    row.presents += b.presents;
    row.absents += b.absents;
  }

  for (const i of inscriptions) {
    const row = acc.get(i.activiteId);
    if (row) row.inscrits.add(i.userId);
  }

  return [...acc.values()]
    .map((r) => {
      const attendus = r.presents + r.absents;
      return {
        ...r,
        inscrits: r.inscrits.size,
        moyenne:
          r.seancesEmargees > 0 ? Math.round((r.presents / r.seancesEmargees) * 10) / 10 : 0,
        tauxPresence: attendus > 0 ? Math.round((r.presents / attendus) * 100) : 0,
        tauxRemplissage: r.capacite > 0 ? Math.round((r.presents / r.capacite) * 100) : 0,
      };
    })
    .sort((a, b) => b.presents - a.presents);
}

export async function parActivite(f: Filtre, deja?: SeanceChargee[]): Promise<LigneActivite[]> {
  const [seances, inscriptions] = await Promise.all([
    seancesDe(f, deja),
    prisma.inscription.findMany({
      where: { statut: "VALIDEE", creneau: { saisonId: f.saisonId } },
      select: { userId: true, creneau: { select: { activiteId: true } } },
    }),
  ]);
  return agregerParActivite(
    seances,
    inscriptions.map((i) => ({ userId: i.userId, activiteId: i.creneau.activiteId })),
  );
}

// ── Évolution mensuelle ────────────────────────────────────────────────────

export type PointMois = {
  cle: string; // « 2026-09 »
  libelle: string; // « septembre 2026 »
  court: string; // « sept. » — axe du graphique
  presents: number;
  seances: number;
  moyenne: number;
};

/**
 * Fréquentation mois par mois, sur les séances émargées.
 *
 * Les mois sans aucune séance émargée sont restitués à zéro plutôt qu'omis :
 * une courbe d'évolution dont l'axe saute d'avril à juillet se lit comme une
 * série continue, et masque précisément le creux qu'elle devrait montrer.
 */
export function agregerMensuel(seances: SeancePourAgregat[]): PointMois[] {
  const acc = new Map<string, { presents: number; seances: number; date: Date }>();

  for (const s of seances) {
    if (s.statut !== "FAITE") continue;
    const cle = cleMois(s.date);
    const row = acc.get(cle) ?? { presents: 0, seances: 0, date: debutMois(s.date) };
    row.seances += 1;
    row.presents += bilanSeance(s).presents;
    acc.set(cle, row);
  }
  if (acc.size === 0) return [];

  const bornes = [...acc.values()].map((r) => r.date.getTime());
  const points: PointMois[] = [];
  for (
    let mois = new Date(Math.min(...bornes));
    mois <= new Date(Math.max(...bornes));
    mois = new Date(Date.UTC(mois.getUTCFullYear(), mois.getUTCMonth() + 1, 1))
  ) {
    const cle = cleMois(mois);
    const r = acc.get(cle);
    points.push({
      cle,
      libelle: fmtMois(mois),
      court: fmtMoisCourt(mois),
      presents: r?.presents ?? 0,
      seances: r?.seances ?? 0,
      moyenne: r && r.seances > 0 ? Math.round((r.presents / r.seances) * 10) / 10 : 0,
    });
  }
  return points;
}

export async function evolutionMensuelle(f: Filtre, deja?: SeanceChargee[]): Promise<PointMois[]> {
  return agregerMensuel(await seancesDe(f, deja));
}

// ── Par direction ──────────────────────────────────────────────────────────

export type LigneDirection = {
  libelle: string;
  agents: number;
  presents: number;
};

/** Le libellé sous lequel un agent se range dans « Participation par direction ». */
export function cleDirection(u: { direction: string | null; service: string | null }): string {
  return u.direction?.trim() || u.service?.trim() || "Non renseignée";
}

export function agregerParDirection(
  seances: (SeancePourAgregat & {
    presences: { user: { direction: string | null; service: string | null } }[];
  })[],
): LigneDirection[] {
  const acc = new Map<string, { agents: Set<string>; presents: number }>();

  for (const s of seances) {
    if (s.statut !== "FAITE") continue;
    for (const p of s.presences) {
      if (!estPresent(p.etat)) continue;
      const cle = cleDirection(p.user);
      const row = acc.get(cle) ?? { agents: new Set<string>(), presents: 0 };
      row.agents.add(p.userId);
      row.presents += 1;
      acc.set(cle, row);
    }
  }

  return [...acc.entries()]
    .map(([libelle, r]) => ({ libelle, agents: r.agents.size, presents: r.presents }))
    .sort((a, b) => b.presents - a.presents);
}

/** Répartition des participants par direction — pour le bilan QVT transverse. */
export async function parDirection(f: Filtre, deja?: SeanceChargee[]): Promise<LigneDirection[]> {
  return agregerParDirection(await seancesDe(f, deja));
}

// ── Par service ────────────────────────────────────────────────────────────

export type LigneService = {
  libelle: string;
  /** Agents distincts ayant au moins une inscription validée sur la saison. */
  inscrits: number;
  /**
   * Effectif du service dans l'annuaire, comptes actifs, après regroupement.
   * Null quand aucun compte de l'annuaire ne s'y rattache — participants hors
   * annuaire, ou libellé saisi à la main : on n'a alors aucun dénominateur, et
   * un taux inventé serait pire que rien.
   */
  effectif: number | null;
  /**
   * Part des agents du service qui sont inscrits, en %. Null sans effectif.
   * Peut dépasser 100 : les inscrits comptent aussi ceux que l'annuaire ne
   * rattache pas à ce service — participants hors annuaire, rattachement
   * forcé à la main. Le chiffre est gardé tel quel, avec une mention à l'écran.
   */
  couverture: number | null;
  /** Part de ce service dans l'ensemble des inscrits, en % ; les parts somment à 100. */
  part: number;
};

/** Le libellé sous lequel un inscrit se range dans « Inscriptions par service ». */
export function cleService(u: { service: string | null; direction: string | null }): string {
  return u.service?.trim() || u.direction?.trim() || "Non renseigné";
}

/**
 * Le taux d'inscription service par service, sur des données en mémoire.
 *
 * `effectifs` est indexé par `cleComparaison` du service **résolu** : c'est la
 * même clé qui range les inscrits, dont `User.service` est lui-même le résultat
 * de `resoudreService`. Comparer le libellé brut de l'annuaire au libellé résolu
 * de l'inscrit ne trouvait jamais « Petite Enfance » en face de « Crèche La
 * Cigogne », et affichait « effectif inconnu » sur des services bien connus.
 */
export function agregerParService(
  inscriptions: { userId: string; user: { service: string | null; direction: string | null } }[],
  effectifs: Map<string, number>,
): LigneService[] {
  // Un agent inscrit à deux activités reste un agent : on compte des personnes,
  // pas des inscriptions, sans quoi un service assidu paraîtrait deux fois plus
  // large qu'il n'est.
  const agents = new Map<string, { libelle: string; ids: Set<string> }>();
  for (const i of inscriptions) {
    const libelle = cleService(i.user);
    const cle = cleComparaison(libelle);
    const row = agents.get(cle) ?? { libelle, ids: new Set<string>() };
    row.ids.add(i.userId);
    agents.set(cle, row);
  }

  const lignes = [...agents.entries()]
    .map(([cle, { libelle, ids }]) => {
      const effectif = effectifs.get(cle) ?? null;
      return {
        libelle,
        inscrits: ids.size,
        effectif,
        couverture:
          effectif && effectif > 0 ? Math.round((ids.size / effectif) * 100) : null,
      };
    })
    .sort(
      (a, b) =>
        (b.couverture ?? -1) - (a.couverture ?? -1) ||
        b.inscrits - a.inscrits ||
        a.libelle.localeCompare(b.libelle, "fr"),
    );

  const parts = repartirEnParts(lignes.map((l) => l.inscrits));
  return lignes.map((l, i) => ({ ...l, part: parts[i] }));
}

/**
 * Effectifs de l'annuaire par service résolu, comptes actifs.
 *
 * Chaque libellé brut passe par les mêmes règles de regroupement et le même
 * référentiel que `User.service` (src/lib/annuaire.ts) : « Crèche La Cigogne »
 * et « Crèche Petit Poucet » tombent dans « Petite Enfance », et l'effectif de
 * ce service est la somme des deux.
 */
export async function effectifsParService(): Promise<Map<string, number>> {
  const [regles, referentiel, comptes] = await Promise.all([
    reglesDeRegroupement(),
    servicesProposes(),
    prisma.adAccount.findMany({ where: { enabled: true }, select: { service: true } }),
  ]);
  const effectifs = new Map<string, number>();
  for (const c of comptes) {
    const service = resoudreService(c.service, regles, referentiel);
    if (!service) continue;
    const cle = cleComparaison(service);
    effectifs.set(cle, (effectifs.get(cle) ?? 0) + 1);
  }
  return effectifs;
}

/**
 * Le taux d'inscription service par service.
 *
 * Deux pourcentages, parce qu'ils ne répondent pas à la même question et que
 * les confondre fausse la lecture :
 *
 *  • la couverture — combien d'agents du service se sont inscrits sur ceux
 *    qu'il compte. C'est elle qui dit où la démarche QVT n'est pas arrivée : un
 *    petit service à 40 % est mieux touché qu'une grande direction à 5 %.
 *  • la part — ce que ce service pèse dans l'ensemble des inscrits. C'est le
 *    chiffre qui circule en comité social, et qui suit mécaniquement la taille
 *    des services.
 *
 * L'effectif vient du miroir d'annuaire (comptes actifs), seule source qui
 * connaisse les agents NON inscrits — ceux que cet écran cherche justement.
 */
export async function parService(f: Filtre): Promise<LigneService[]> {
  const [inscriptions, effectifs] = await Promise.all([
    prisma.inscription.findMany({
      where: {
        statut: "VALIDEE",
        creneau: {
          saisonId: f.saisonId,
          ...(f.activiteId ? { activiteId: f.activiteId } : {}),
        },
      },
      select: { userId: true, user: { select: { service: true, direction: true } } },
    }),
    effectifsParService(),
  ]);
  return agregerParService(inscriptions, effectifs);
}

// ── Décrocheurs ────────────────────────────────────────────────────────────

export type Decrocheur = {
  userId: string;
  nom: string;
  email: string | null;
  activite: string;
  creneauId: string;
  absencesConsecutives: number;
  derniereVenue: Date | null;
};

/**
 * Agents inscrits qui ont cessé de venir : `seuil` dernières séances émargées
 * de leur créneau sans une seule présence. C'est la liste sur laquelle le
 * service des sports relance — et qui dit s'il faut rouvrir des places.
 */
export async function decrocheurs(f: Filtre, seuil: number): Promise<Decrocheur[]> {
  const inscriptions = await prisma.inscription.findMany({
    where: {
      statut: "VALIDEE",
      // Un compte désactivé — départ de la collectivité — n'a personne à
      // relancer : le lister ferait écrire dans le vide.
      user: { active: true },
      // Pas les créneaux archivés : relancer quelqu'un pour un créneau qu'il
      // ne voit plus, en l'invitant à s'en désinscrire, n'a pas de sens.
      creneau: {
        saisonId: f.saisonId,
        archiveAt: null,
        ...(f.activiteId ? { activiteId: f.activiteId } : {}),
      },
    },
    select: {
      userId: true,
      creneauId: true,
      decisionAt: true,
      demandeAt: true,
      user: { select: { displayName: true, email: true, emailContact: true } },
      creneau: { select: { activite: { select: { nom: true } } } },
    },
  });
  if (inscriptions.length === 0) return [];

  const today = aujourdhui();
  const creneauIds = [...new Set(inscriptions.map((i) => i.creneauId))];
  const seances = await prisma.seance.findMany({
    where: { creneauId: { in: creneauIds }, statut: "FAITE", date: { lte: today } },
    include: { presences: { select: { userId: true, etat: true } } },
    orderBy: { date: "desc" },
  });

  const parCreneau = new Map<string, typeof seances>();
  for (const s of seances) {
    const arr = parCreneau.get(s.creneauId) ?? [];
    arr.push(s);
    parCreneau.set(s.creneauId, arr);
  }

  const resultat: Decrocheur[] = [];
  for (const i of inscriptions) {
    // Seules comptent les séances depuis son inscription : un arrivant récent
    // n'a pas « décroché » des séances qui ont eu lieu avant lui.
    const recentes = (parCreneau.get(i.creneauId) ?? [])
      .filter((s) => participeALaSeance(i, s.date))
      .slice(0, seuil);
    if (recentes.length < seuil) continue; // pas assez d'historique pour conclure

    let absences = 0;
    for (const s of recentes) {
      const p = s.presences.find((x) => x.userId === i.userId);
      if (p && estPresent(p.etat)) break;
      absences += 1;
    }
    if (absences < seuil) continue;

    const venue = (parCreneau.get(i.creneauId) ?? []).find((s) =>
      s.presences.some((p) => p.userId === i.userId && estPresent(p.etat)),
    );

    resultat.push({
      userId: i.userId,
      nom: i.user.displayName,
      email: adresseDeContact(i.user),
      activite: i.creneau.activite.nom,
      creneauId: i.creneauId,
      absencesConsecutives: absences,
      derniereVenue: venue?.date ?? null,
    });
  }

  return resultat.sort((a, b) => b.absencesConsecutives - a.absencesConsecutives);
}

// ── Comparaison avec la saison précédente ──────────────────────────────────

/**
 * Mêmes indicateurs, sur la saison qui précède immédiatement celle filtrée.
 *
 * « 62 % de présence » ne dit rien seul : c'est mieux ou moins bien que
 * l'an dernier qui intéresse un comité social. Renvoie null tant qu'il n'existe
 * pas de saison antérieure — le premier exercice n'a rien à comparer.
 */
export async function saisonPrecedente(saisonId: string) {
  const actuelle = await prisma.saison.findUnique({ where: { id: saisonId } });
  if (!actuelle) return null;
  return prisma.saison.findFirst({
    where: { debut: { lt: actuelle.debut } },
    orderBy: { debut: "desc" },
  });
}

export type Ecart = { valeur: number; precedent: number; delta: number };

/** Écart en points ou en valeur absolue, selon ce que compare l'indicateur. */
export function ecart(valeur: number, precedent: number | null): Ecart | null {
  if (precedent === null) return null;
  return { valeur, precedent, delta: Math.round((valeur - precedent) * 10) / 10 };
}

// ── Demande non satisfaite ─────────────────────────────────────────────────

export type DemandeActivite = {
  activiteId: string;
  nom: string;
  couleur: string;
  enAttente: number; // agents en liste d'attente
  aArbitrer: number; // demandes sans décision
  refusees: number;
  places: number;
  occupees: number;
};

/**
 * Ce que l'offre ne couvre pas : listes d'attente, demandes refusées, créneaux
 * saturés. C'est l'indicateur qui justifie d'ouvrir un créneau ou de négocier
 * un créneau de gymnase supplémentaire — le taux de remplissage, lui, plafonne
 * à 100 % et ne dit rien de la file derrière.
 */
export async function demandeNonSatisfaite(f: Filtre): Promise<DemandeActivite[]> {
  const creneaux = await prisma.creneau.findMany({
    where: {
      saisonId: f.saisonId,
      ...(f.activiteId ? { activiteId: f.activiteId } : {}),
    },
    include: {
      activite: true,
      inscriptions: { select: { statut: true, userId: true } },
    },
  });

  const acc = new Map<string, DemandeActivite & { agents: Set<string> }>();
  for (const c of creneaux) {
    const a = c.activite;
    if (!acc.has(a.id)) {
      acc.set(a.id, {
        activiteId: a.id,
        nom: a.nom,
        couleur: a.couleur,
        enAttente: 0,
        aArbitrer: 0,
        refusees: 0,
        places: 0,
        occupees: 0,
        agents: new Set(),
      });
    }
    const row = acc.get(a.id)!;
    // Capacité mutualisée : les places de l'activité ne se comptent qu'une fois,
    // sur le premier créneau rencontré.
    if (!a.capacitePartagee) row.places += c.capacite;
    else if (row.places === 0) row.places = a.capacite ?? c.capacite;

    for (const i of c.inscriptions) {
      if (i.statut === "VALIDEE") row.agents.add(i.userId);
      if (i.statut === "LISTE_ATTENTE") row.enAttente += 1;
      if (i.statut === "EN_ATTENTE") row.aArbitrer += 1;
      if (i.statut === "REFUSEE") row.refusees += 1;
    }
  }

  return [...acc.values()]
    .map(({ agents, ...row }) => ({ ...row, occupees: agents.size }))
    .sort((a, b) => b.enAttente - a.enAttente || a.nom.localeCompare(b.nom, "fr"));
}

// ── Grille jour × heure ────────────────────────────────────────────────────

export type CaseGrille = {
  jour: Jour;
  heure: number; // tranche horaire entamée : 12 pour 12:15
  creneaux: number;
  placesMoyennes: number; // places offertes par séance, moyennées sur la case
  presentsMoyens: number;
  tauxRemplissage: number;
  activites: string[];
};

/**
 * Remplissage moyen par jour de la semaine et tranche horaire.
 *
 * Répond à une question que le tableau par activité ne traite pas : « où placer
 * la séance supplémentaire ? ». Les cases vides sont aussi parlantes que les
 * pleines — un mardi 17 h saturé et un vendredi 12 h désert ne se lisent nulle
 * part ailleurs.
 */
export function agregerGrille(
  seances: (SeancePourAgregat & {
    creneauId: string;
    creneau: { jour: Jour; heureDebut: string; activite: { nom: string } };
  })[],
): CaseGrille[] {
  const emargees = seances.filter((s) => s.statut === "FAITE");

  const acc = new Map<
    string,
    {
      jour: Jour;
      heure: number;
      presents: number;
      // Places cumulées **par séance** et non par créneau : une case peut
      // réunir deux activités aux capacités différentes, et rapporter une
      // moyenne par séance à la somme de leurs capacités sous-estimerait le
      // remplissage d'autant.
      placesCumulees: number;
      seances: number;
      creneauxIds: Set<string>;
      noms: Set<string>;
    }
  >();

  for (const s of emargees) {
    const heure = Number(s.creneau.heureDebut.slice(0, 2));
    const cle = `${s.creneau.jour}-${heure}`;
    if (!acc.has(cle)) {
      acc.set(cle, {
        jour: s.creneau.jour,
        heure,
        presents: 0,
        placesCumulees: 0,
        seances: 0,
        creneauxIds: new Set(),
        noms: new Set(),
      });
    }
    const row = acc.get(cle)!;
    row.seances += 1;
    row.presents += bilanSeance(s).presents;
    row.placesCumulees += placesOffertes(s);
    row.noms.add(s.creneau.activite.nom);
    row.creneauxIds.add(s.creneauId);
  }

  return [...acc.values()]
    .map((row) => ({
      jour: row.jour,
      heure: row.heure,
      creneaux: row.creneauxIds.size,
      placesMoyennes:
        row.seances > 0 ? Math.round((row.placesCumulees / row.seances) * 10) / 10 : 0,
      presentsMoyens:
        row.seances > 0 ? Math.round((row.presents / row.seances) * 10) / 10 : 0,
      tauxRemplissage:
        row.placesCumulees > 0 ? Math.round((row.presents / row.placesCumulees) * 100) : 0,
      activites: [...row.noms].sort((a, b) => a.localeCompare(b, "fr")),
    }))
    .sort((a, b) => jourIndex(a.jour) - jourIndex(b.jour) || a.heure - b.heure);
}

export async function grilleJourHeure(f: Filtre, deja?: SeanceChargee[]): Promise<CaseGrille[]> {
  return agregerGrille(await seancesDe(f, deja));
}

// ── Assiduité et fidélisation ──────────────────────────────────────────────

export type Assiduite = {
  agents: number; // inscrits validés, distincts
  venus: number; // parmi eux, venus au moins une fois sur leurs créneaux
  jamaisVenus: number;
  occasionnels: number; // moins de 40 % des séances proposées
  reguliers: number; // 40 à 80 %
  assidus: number; // 80 % et plus
  seancesMoyennes: number; // séances suivies par agent venu au moins une fois
  tauxAssiduite: number; // présences / séances proposées aux inscrits
};

export type AssiduiteAgent = { venues: number; proposees: number };

export type InscriptionPourAssiduite = {
  userId: string;
  creneauId: string;
  decisionAt: Date | null;
  demandeAt: Date;
};

/**
 * Venues et séances proposées, agent par agent — le socle commun de
 * `assiduite`, de la coupe par agent et de la fiche : un écran qui annonce
 * trois « jamais venus » et n'en liste que deux fait douter des deux chiffres.
 *
 * Ne lui sont « proposées » que les séances **émargées** de ses créneaux depuis
 * son inscription : on ne reproche pas à un agent une séance annulée, ni une
 * feuille jamais transmise, ni — arrivé en janvier — les séances d'automne.
 *
 * Le numérateur se limite à ce même périmètre. Sans cela, une venue hors de
 * ses créneaux — participant ponctuel, séance antérieure à son inscription — se
 * comptait au numérateur sans jamais figurer au dénominateur, et le taux
 * dépassait 100 %.
 */
export function assiduiteParAgent(
  seances: { id: string; creneauId: string; date: Date; statut: string; presences: PresencePourBilan[] }[],
  inscriptions: InscriptionPourAssiduite[],
): Map<string, AssiduiteAgent> {
  const emargees = seances.filter((s) => s.statut === "FAITE");
  const parCreneau = new Map<string, { id: string; date: Date }[]>();
  for (const s of emargees) {
    parCreneau.set(s.creneauId, [...(parCreneau.get(s.creneauId) ?? []), s]);
  }

  const agents = new Map<string, AssiduiteAgent>();
  const perimetre = new Set<string>();
  for (const i of inscriptions) {
    const siennes = (parCreneau.get(i.creneauId) ?? []).filter((s) =>
      participeALaSeance(i, s.date),
    );
    const row = agents.get(i.userId) ?? { venues: 0, proposees: 0 };
    row.proposees += siennes.length;
    agents.set(i.userId, row);
    for (const s of siennes) perimetre.add(`${i.userId}:${s.id}`);
  }

  for (const s of emargees) {
    for (const p of s.presences) {
      if (!estPresent(p.etat)) continue;
      if (!perimetre.has(`${p.userId}:${s.id}`)) continue;
      agents.get(p.userId)!.venues += 1;
    }
  }
  return agents;
}

export type Bande = "assidus" | "reguliers" | "occasionnels" | "jamais";

/**
 * La bande d'assiduité d'un agent. Celui dont aucune séance n'a encore été
 * émargée est rangé avec les occasionnels plutôt qu'exclu du total — et
 * surtout pas parmi les « jamais venus », qui déclenche une relance.
 */
export function bandeAssiduite(a: AssiduiteAgent): Bande {
  if (a.proposees === 0) return "occasionnels";
  if (a.venues === 0) return "jamais";
  const part = a.venues / a.proposees;
  if (part >= 0.8) return "assidus";
  if (part >= 0.4) return "reguliers";
  return "occasionnels";
}

/**
 * Répartition des inscrits selon leur régularité.
 *
 * Le taux de présence global masque deux populations très différentes : un
 * groupe qui vient toujours et un groupe qui ne vient jamais donnent la même
 * moyenne qu'un groupe qui vient une fois sur deux. Or l'action à mener n'est
 * pas la même.
 */
export function agregerAssiduite(
  seances: Parameters<typeof assiduiteParAgent>[0],
  inscriptions: InscriptionPourAssiduite[],
): Assiduite {
  const parAgent = assiduiteParAgent(seances, inscriptions);
  const bandes: Record<Bande, number> = { assidus: 0, reguliers: 0, occasionnels: 0, jamais: 0 };
  let totalVenues = 0;
  let totalProposees = 0;
  let venus = 0;
  for (const a of parAgent.values()) {
    totalVenues += a.venues;
    totalProposees += a.proposees;
    if (a.venues > 0) venus += 1;
    bandes[bandeAssiduite(a)] += 1;
  }
  return {
    agents: parAgent.size,
    venus,
    jamaisVenus: bandes.jamais,
    occasionnels: bandes.occasionnels,
    reguliers: bandes.reguliers,
    assidus: bandes.assidus,
    seancesMoyennes: venus > 0 ? Math.round((totalVenues / venus) * 10) / 10 : 0,
    tauxAssiduite: totalProposees > 0 ? Math.round((totalVenues / totalProposees) * 100) : 0,
  };
}

export async function assiduite(f: Filtre, deja?: SeanceChargee[]): Promise<Assiduite> {
  const [seances, inscriptions] = await Promise.all([
    seancesDe(f, deja),
    prisma.inscription.findMany({
      where: {
        statut: "VALIDEE",
        creneau: {
          saisonId: f.saisonId,
          ...(f.activiteId ? { activiteId: f.activiteId } : {}),
        },
      },
      select: { userId: true, creneauId: true, decisionAt: true, demandeAt: true },
    }),
  ]);
  return agregerAssiduite(seances, inscriptions);
}

// ── Absences et annulations ────────────────────────────────────────────────

export type Fiabilite = {
  absencesAnnoncees: number; // annoncées ET pointées absentes sur la feuille
  absencesConstatees: number; // pointées absentes sur une feuille
  partAnnoncee: number; // % des absences constatées qui avaient été annoncées
  seancesAnnulees: number;
  seancesPrevues: number; // séances déjà passées, ou annulées
  tauxAnnulation: number;
  motifs: { motif: string; nombre: number }[];
  desistements: number; // inscriptions abandonnées en cours de saison
  /**
   * Ce que devient une place rendue à la file.
   *
   * `promotions` : places libérées attribuées au premier de la liste d'attente.
   * `promotionsRendues` : celles que l'intéressé a aussitôt refusées — il
   * s'était inscrit des semaines plus tôt, et entre-temps ses horaires ont
   * changé ou l'envie est passée.
   *
   * L'indicateur mesure la fraîcheur de la file, pas la fiabilité des gens :
   * une part élevée dit qu'on y attend trop longtemps, et que la place fait
   * deux tours de piste avant de trouver preneur — pendant lesquels le créneau
   * paraît complet alors qu'il ne l'est pas.
   */
  promotions: number;
  promotionsRendues: number;
  tauxPromotionRendue: number;
};

export type FiabiliteSeances = Pick<
  Fiabilite,
  | "absencesAnnoncees"
  | "absencesConstatees"
  | "partAnnoncee"
  | "seancesAnnulees"
  | "seancesPrevues"
  | "tauxAnnulation"
  | "motifs"
>;

/**
 * La part des séances dans la fiabilité : annulations et absences prévenues.
 *
 * Une absence annoncée ne compte que si la feuille l'a confirmée — l'agent a
 * une ligne ABSENT sur la séance. Une annonce pour une séance dont la feuille
 * ne le mentionne pas n'a été constatée par personne ; la compter gonflait la
 * part au-delà de 100 %, qu'un `min` masquait sans l'expliquer.
 *
 * Le dénominateur des annulations ne retient que les séances déjà passées, ou
 * annulées : les séances à venir n'ont encore rien prouvé, et les compter
 * diluait le taux en début de saison jusqu'à le rendre illisible.
 */
export function agregerFiabilite(
  seances: (SeancePourAgregat & { motifAnnulation: string | null })[],
  annoncees: { seanceId: string; userId: string }[],
  today: Date = aujourdhui(),
): FiabiliteSeances {
  const annulees = seances.filter((s) => s.statut === "ANNULEE");
  const emargees = seances.filter((s) => s.statut === "FAITE");
  const prevues = seances.filter((s) => s.statut === "ANNULEE" || s.date <= today).length;

  const absentes = new Set<string>();
  let constatees = 0;
  for (const s of emargees) {
    for (const p of s.presences) {
      if (p.etat !== "ABSENT") continue;
      constatees += 1;
      absentes.add(`${s.id}:${p.userId}`);
    }
  }
  const confirmees = annoncees.filter((a) => absentes.has(`${a.seanceId}:${a.userId}`)).length;

  const motifs = new Map<string, number>();
  for (const s of annulees) {
    const cle = motifNormalise(s.motifAnnulation);
    motifs.set(cle, (motifs.get(cle) ?? 0) + 1);
  }

  return {
    absencesAnnoncees: confirmees,
    absencesConstatees: constatees,
    partAnnoncee: constatees > 0 ? Math.round((confirmees / constatees) * 100) : 0,
    seancesAnnulees: annulees.length,
    seancesPrevues: prevues,
    tauxAnnulation: prevues > 0 ? Math.round((annulees.length / prevues) * 100) : 0,
    motifs: [...motifs.entries()]
      .map(([motif, nombre]) => ({ motif, nombre }))
      .sort((a, b) => b.nombre - a.nombre)
      .slice(0, 6),
  };
}

/**
 * Fiabilité de part et d'autre : l'offre tient-elle ses séances, les inscrits
 * préviennent-ils quand ils ne viennent pas ?
 *
 * La part d'absences annoncées est l'indicateur le plus actionnable : c'est lui
 * qui décide si l'animateur peut anticiper son effectif, et il se travaille par
 * un rappel la veille.
 */
export async function fiabilite(f: Filtre, deja?: SeanceChargee[]): Promise<Fiabilite> {
  const perimetre = {
    creneau: {
      saisonId: f.saisonId,
      ...(f.activiteId ? { activiteId: f.activiteId } : {}),
    },
  };
  const [seances, annoncees, desistements, promotions, promotionsRendues] =
    await Promise.all([
      seancesDe(f, deja),
      // Sur les seules séances émargées : une absence annoncée pour la semaine
      // prochaine n'a encore été constatée par personne.
      prisma.absenceAnnoncee.findMany({
        where: { seance: { ...perimetre, statut: "FAITE" } },
        select: { seanceId: true, userId: true },
      }),
      prisma.inscription.count({ where: { statut: "DESISTEE", ...perimetre } }),
      prisma.inscription.count({ where: { promuAt: { not: null }, ...perimetre } }),
      prisma.inscription.count({
        where: { promuAt: { not: null }, statut: "DESISTEE", ...perimetre },
      }),
    ]);

  return {
    ...agregerFiabilite(seances, annoncees),
    desistements,
    promotions,
    promotionsRendues,
    tauxPromotionRendue:
      promotions > 0 ? Math.round((promotionsRendues / promotions) * 100) : 0,
  };
}

// ── Export CSV ─────────────────────────────────────────────────────────────

/**
 * Une cellule CSV telle qu'Excel l'ouvrira sans l'interpréter.
 *
 * Un nom d'activité ou un lieu est saisi librement par le service des sports.
 * Commençant par `=`, `+`, `-` ou `@`, Excel le lit comme une formule à
 * l'ouverture du fichier — c'est la voie classique pour faire exécuter quelque
 * chose à qui ouvre un export. Une apostrophe en tête le ramène à du texte ;
 * les guillemets protègent séparateurs et retours à la ligne.
 */
export function celluleCsv(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Export CSV du détail des séances — destiné au retraitement, pas à la lecture. */
export async function exportCsv(f: Filtre): Promise<string> {
  const seances = await chargerSeances(f);
  const lignes = [
    [
      "date",
      "activite",
      "creneau",
      "lieu",
      "statut",
      "attendus",
      "presents",
      "absents",
      "pointes",
      "places_offertes",
    ].join(";"),
  ];
  for (const s of seances) {
    const b = bilanSeance(s);
    lignes.push(
      [
        isoDate(s.date),
        s.creneau.activite.nom,
        `${s.creneau.heureDebut}-${s.creneau.heureFin}`,
        s.creneau.lieu ?? "",
        s.statut,
        b.attendus,
        b.presents,
        b.absents,
        s.presences.length,
        placesOffertes(s),
      ]
        .map(celluleCsv)
        .join(";"),
    );
  }
  // BOM en tête : sans lui, Excel ouvre le CSV en ANSI et casse les accents.
  return `﻿${lignes.join("\r\n")}\r\n`;
}
