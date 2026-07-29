import type { EtatPresence, Jour } from "@prisma/client";
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
import { participeALaSeance } from "./inscriptions";

/**
 * Statistiques de fréquentation — la finalité de l'outil côté QVT.
 *
 * Les volumes sont modestes (une saison ≈ 5 activités × 35 séances × 25 agents,
 * soit quelques milliers de lignes) : on charge la saison et on agrège en
 * mémoire. C'est plus lisible qu'un empilement de `groupBy` Prisma, et cela
 * permet des indicateurs croisés (activité × mois × direction) sans multiplier
 * les allers-retours en base.
 */

export type Filtre = {
  saisonId: string;
  activiteId?: string;
  du?: Date;
  au?: Date;
};

function estPresent(etat: EtatPresence): boolean {
  return etat === "PRESENT";
}

/**
 * Places offertes par une séance.
 *
 * Le créneau porte sa capacité, sauf quand l'activité mutualise la sienne :
 * `Creneau.capacite` n'est alors qu'une valeur résiduelle, et la rapporter aux
 * présences donnerait un taux de remplissage calculé sur un effectif qui n'est
 * pas celui du groupe.
 */
export function placesOffertes(seance: {
  creneau: {
    capacite: number;
    activite: { capacitePartagee: boolean; capacite: number | null };
  };
}): number {
  const a = seance.creneau.activite;
  return a.capacitePartagee ? (a.capacite ?? seance.creneau.capacite) : seance.creneau.capacite;
}

async function chargerSeances(f: Filtre) {
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
      creneau: { include: { activite: true } },
      presences: { include: { user: true } },
    },
    orderBy: { date: "asc" },
  });
}

export type Indicateurs = {
  seancesTotal: number;
  seancesEmargees: number;
  seancesAnnulees: number;
  seancesPassees: number;
  tauxEmargement: number; // séances émargées / séances passées non annulées
  presents: number;
  absents: number;
  tauxPresence: number; // présents / lignes pointées
  frequentationMoyenne: number; // présents par séance émargée
  inscrits: number; // inscriptions validées distinctes
  agentsUniques: number; // agents ayant participé au moins une fois
  capacite: number; // somme des capacités × séances émargées
  tauxRemplissage: number;
};

export async function indicateurs(f: Filtre): Promise<Indicateurs> {
  const [seances, inscriptions] = await Promise.all([
    chargerSeances(f),
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
  let presents = 0;
  let absents = 0;
  let pointees = 0;
  let capacite = 0;
  const agents = new Set<string>();

  const emargees = seances.filter((s) => s.statut === "FAITE");
  const annulees = seances.filter((s) => s.statut === "ANNULEE").length;
  const passees = seances.filter((s) => s.date <= today && s.statut !== "ANNULEE").length;

  for (const s of emargees) {
    capacite += placesOffertes(s);
    for (const p of s.presences) {
      pointees += 1;
      if (estPresent(p.etat)) {
        presents += 1;
        agents.add(p.userId);
      } else absents += 1;
    }
  }

  return {
    seancesTotal: seances.length,
    seancesEmargees: emargees.length,
    seancesAnnulees: annulees,
    seancesPassees: passees,
    tauxEmargement: passees > 0 ? Math.round((emargees.length / passees) * 100) : 0,
    presents,
    absents,
    tauxPresence: pointees > 0 ? Math.round((presents / pointees) * 100) : 0,
    frequentationMoyenne:
      emargees.length > 0 ? Math.round((presents / emargees.length) * 10) / 10 : 0,
    inscrits: new Set(inscriptions.map((i) => i.userId)).size,
    agentsUniques: agents.size,
    capacite,
    tauxRemplissage: capacite > 0 ? Math.round((presents / capacite) * 100) : 0,
  };
}

export type LigneActivite = {
  activiteId: string;
  nom: string;
  couleur: string;
  seancesEmargees: number;
  presents: number;
  absents: number;
  inscrits: number;
  capacite: number;
  moyenne: number;
  tauxPresence: number;
  tauxRemplissage: number;
};

export async function parActivite(f: Filtre): Promise<LigneActivite[]> {
  const [seances, inscriptions] = await Promise.all([
    chargerSeances(f),
    prisma.inscription.findMany({
      where: { statut: "VALIDEE", creneau: { saisonId: f.saisonId } },
      include: { creneau: { select: { activiteId: true } } },
    }),
  ]);

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
    for (const p of s.presences) {
      if (estPresent(p.etat)) row.presents += 1;
      else if (p.etat === "ABSENT") row.absents += 1;
    }
  }

  for (const i of inscriptions) {
    const row = acc.get(i.creneau.activiteId);
    if (row) row.inscrits.add(i.userId);
  }

  return [...acc.values()]
    .map((r) => {
      const pointees = r.presents + r.absents;
      return {
        ...r,
        inscrits: r.inscrits.size,
        moyenne:
          r.seancesEmargees > 0 ? Math.round((r.presents / r.seancesEmargees) * 10) / 10 : 0,
        tauxPresence: pointees > 0 ? Math.round((r.presents / pointees) * 100) : 0,
        tauxRemplissage: r.capacite > 0 ? Math.round((r.presents / r.capacite) * 100) : 0,
      };
    })
    .sort((a, b) => b.presents - a.presents);
}

export type PointMois = {
  cle: string; // « 2026-09 »
  libelle: string; // « septembre 2026 »
  court: string; // « sept. » — axe du graphique
  presents: number;
  seances: number;
  moyenne: number;
};

/**
 * Fréquentation mois par mois.
 *
 * Les mois sans aucune séance émargée sont restitués à zéro plutôt qu'omis :
 * une courbe d'évolution dont l'axe saute d'avril à juillet se lit comme une
 * série continue, et masque précisément le creux qu'elle devrait montrer.
 */
export async function evolutionMensuelle(f: Filtre): Promise<PointMois[]> {
  const seances = await chargerSeances(f);
  const acc = new Map<string, { presents: number; seances: number; date: Date }>();

  for (const s of seances) {
    if (s.statut !== "FAITE") continue;
    const cle = cleMois(s.date);
    const row = acc.get(cle) ?? { presents: 0, seances: 0, date: debutMois(s.date) };
    row.seances += 1;
    row.presents += s.presences.filter((p) => estPresent(p.etat)).length;
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

export type LigneDirection = {
  libelle: string;
  agents: number;
  presents: number;
};

/** Répartition des participants par direction — pour le bilan QVT transverse. */
export async function parDirection(f: Filtre): Promise<LigneDirection[]> {
  const seances = await chargerSeances(f);
  const acc = new Map<string, { agents: Set<string>; presents: number }>();

  for (const s of seances) {
    if (s.statut !== "FAITE") continue;
    for (const p of s.presences) {
      if (!estPresent(p.etat)) continue;
      const cle = p.user.direction?.trim() || p.user.service?.trim() || "Non renseignée";
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
      creneau: {
        saisonId: f.saisonId,
        ...(f.activiteId ? { activiteId: f.activiteId } : {}),
      },
    },
    include: {
      user: true,
      creneau: { include: { activite: true } },
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
      email: i.user.email,
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
export async function grilleJourHeure(f: Filtre): Promise<CaseGrille[]> {
  const seances = await chargerSeances(f);
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
    row.presents += s.presences.filter((p) => estPresent(p.etat)).length;
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

// ── Assiduité et fidélisation ──────────────────────────────────────────────

export type Assiduite = {
  agents: number; // inscrits validés, distincts
  jamaisVenus: number;
  occasionnels: number; // moins de 40 % des séances proposées
  reguliers: number; // 40 à 80 %
  assidus: number; // 80 % et plus
  seancesMoyennes: number; // séances suivies par agent venu au moins une fois
  tauxAssiduite: number; // présences / séances proposées aux inscrits
};

/**
 * Répartition des inscrits selon leur régularité.
 *
 * Le taux de présence global masque deux populations très différentes : un
 * groupe qui vient toujours et un groupe qui ne vient jamais donnent la même
 * moyenne qu'un groupe qui vient une fois sur deux. Or l'action à mener n'est
 * pas la même.
 *
 * Le dénominateur est le nombre de séances **émargées** de ses créneaux : on ne
 * reproche pas à un agent une séance annulée, ni une feuille jamais transmise.
 */
export async function assiduite(f: Filtre): Promise<Assiduite> {
  const [seances, inscriptions] = await Promise.all([
    chargerSeances(f),
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

  const emargees = seances.filter((s) => s.statut === "FAITE");
  const parCreneau = new Map<string, { id: string; date: Date }[]>();
  for (const s of emargees) {
    parCreneau.set(s.creneauId, [...(parCreneau.get(s.creneauId) ?? []), s]);
  }

  // Ne lui sont « proposées » que les séances depuis son inscription : arrivé
  // en janvier, l'agent n'a pas à traîner les séances d'automne dans son taux.
  //
  // On retient au passage le couple agent × séance : le numérateur doit se
  // limiter à ce même périmètre. Sans cela, une venue hors de ses créneaux —
  // participant ponctuel, séance antérieure à son inscription — se comptait au
  // numérateur sans jamais figurer au dénominateur, et le taux dépassait 100 %.
  const proposees = new Map<string, number>();
  const perimetre = new Set<string>();
  for (const i of inscriptions) {
    const siennes = (parCreneau.get(i.creneauId) ?? []).filter((s) =>
      participeALaSeance(i, s.date),
    );
    proposees.set(i.userId, (proposees.get(i.userId) ?? 0) + siennes.length);
    for (const s of siennes) perimetre.add(`${i.userId}:${s.id}`);
  }

  const venues = new Map<string, number>();
  for (const s of emargees) {
    for (const p of s.presences) {
      if (!estPresent(p.etat)) continue;
      if (!perimetre.has(`${p.userId}:${s.id}`)) continue;
      venues.set(p.userId, (venues.get(p.userId) ?? 0) + 1);
    }
  }

  let jamaisVenus = 0;
  let occasionnels = 0;
  let reguliers = 0;
  let assidus = 0;
  let totalVenues = 0;
  let totalProposees = 0;

  let venus = 0;
  for (const [userId, nb] of proposees) {
    const venu = venues.get(userId) ?? 0;
    totalVenues += venu;
    totalProposees += nb;
    if (venu > 0) venus += 1;
    // Aucune séance émargée sur ses créneaux depuis son inscription : on ne
    // peut rien conclure. On le range avec les occasionnels plutôt que de
    // l'exclure du total — et surtout pas parmi les « jamais venus », qui
    // déclenche une relance.
    if (nb === 0) {
      occasionnels += 1;
      continue;
    }
    if (venu === 0) {
      jamaisVenus += 1;
      continue;
    }
    const part = venu / nb;
    if (part >= 0.8) assidus += 1;
    else if (part >= 0.4) reguliers += 1;
    else occasionnels += 1;
  }
  return {
    agents: proposees.size,
    jamaisVenus,
    occasionnels,
    reguliers,
    assidus,
    seancesMoyennes: venus > 0 ? Math.round((totalVenues / venus) * 10) / 10 : 0,
    tauxAssiduite: totalProposees > 0 ? Math.round((totalVenues / totalProposees) * 100) : 0,
  };
}

// ── Absences et annulations ────────────────────────────────────────────────

export type Fiabilite = {
  absencesAnnoncees: number;
  absencesConstatees: number; // pointées absentes sur une feuille
  partAnnoncee: number; // % des absences qui avaient été annoncées
  seancesAnnulees: number;
  seancesPrevues: number;
  tauxAnnulation: number;
  motifs: { motif: string; nombre: number }[];
  desistements: number; // inscriptions abandonnées en cours de saison
};

/**
 * Fiabilité de part et d'autre : l'offre tient-elle ses séances, les inscrits
 * préviennent-ils quand ils ne viennent pas ?
 *
 * La part d'absences annoncées est l'indicateur le plus actionnable : c'est lui
 * qui décide si l'animateur peut anticiper son effectif, et il se travaille par
 * un rappel la veille.
 */
export async function fiabilite(f: Filtre): Promise<Fiabilite> {
  const perimetre = {
    creneau: {
      saisonId: f.saisonId,
      ...(f.activiteId ? { activiteId: f.activiteId } : {}),
    },
  };
  const [seances, annoncees, desistements] = await Promise.all([
    chargerSeances(f),
    prisma.absenceAnnoncee.count({ where: { seance: perimetre } }),
    prisma.inscription.count({ where: { statut: "DESISTEE", ...perimetre } }),
  ]);

  const annulees = seances.filter((s) => s.statut === "ANNULEE");
  const constatees = seances
    .filter((s) => s.statut === "FAITE")
    .reduce((n, s) => n + s.presences.filter((p) => !estPresent(p.etat)).length, 0);

  const motifs = new Map<string, number>();
  for (const s of annulees) {
    const cle = (s.motifAnnulation ?? "Motif non renseigné").trim() || "Motif non renseigné";
    motifs.set(cle, (motifs.get(cle) ?? 0) + 1);
  }

  return {
    absencesAnnoncees: annoncees,
    absencesConstatees: constatees,
    // Une absence annoncée finit pointée absente : les annoncées sont donc un
    // sous-ensemble des constatées, sauf feuille non transmise.
    partAnnoncee: constatees > 0 ? Math.min(100, Math.round((annoncees / constatees) * 100)) : 0,
    seancesAnnulees: annulees.length,
    seancesPrevues: seances.length,
    tauxAnnulation:
      seances.length > 0 ? Math.round((annulees.length / seances.length) * 100) : 0,
    motifs: [...motifs.entries()]
      .map(([motif, nombre]) => ({ motif, nombre }))
      .sort((a, b) => b.nombre - a.nombre)
      .slice(0, 6),
    desistements,
  };
}

/** Export CSV du détail des séances — pièce jointe du bilan QVT. */
export async function exportCsv(f: Filtre): Promise<string> {
  const seances = await chargerSeances(f);
  const lignes = [
    [
      "date",
      "activite",
      "creneau",
      "lieu",
      "statut",
      "inscrits_pointes",
      "presents",
      "absents",
      "capacite",
    ].join(";"),
  ];
  for (const s of seances) {
    const c = (e: EtatPresence) => s.presences.filter((p) => p.etat === e).length;
    lignes.push(
      [
        isoDate(s.date),
        s.creneau.activite.nom,
        `${s.creneau.heureDebut}-${s.creneau.heureFin}`,
        s.creneau.lieu ?? "",
        s.statut,
        s.presences.length,
        c("PRESENT"),
        c("ABSENT"),
        placesOffertes(s),
      ]
        .map((v) => String(v).replace(/;/g, ","))
        .join(";"),
    );
  }
  // BOM en tête : sans lui, Excel ouvre le CSV en ANSI et casse les accents.
  return `﻿${lignes.join("\r\n")}\r\n`;
}
