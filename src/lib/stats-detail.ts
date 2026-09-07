import type { Jour } from "@prisma/client";
import { prisma } from "./db";
import { JOUR_LABELS } from "./dates";
import { participeALaSeance } from "./inscriptions";
import {
  chargerSeances,
  estPresent,
  placesOffertes,
  type Filtre,
} from "./stats";

/**
 * Ce qui compose un chiffre des statistiques.
 *
 * Chaque ligne de ces écrans est un total, et un total ne dit pas quoi faire :
 * « 3 jamais venus » appelle une relance, encore faut-il savoir lesquels ;
 * « Petite Enfance — 1 agent » soulève aussitôt la question de savoir qui, et
 * sur quelle activité. La réponse demandait jusqu'ici d'exporter le classeur
 * et de filtrer à la main, c'est-à-dire de quitter l'application au moment
 * précis où elle devenait utile.
 *
 * Les périmètres sont ceux des indicateurs correspondants, repris à
 * l'identique. Les deux doivent rester d'accord : un écran qui annonce trois
 * « jamais venus » et n'en liste que deux fait douter des deux chiffres.
 */

export type Coupe =
  | { type: "direction"; valeur: string }
  | { type: "assiduite"; valeur: string } // assidus | reguliers | occasionnels | jamais
  | { type: "mois"; valeur: string } // « 2026-09 »
  | { type: "activite"; valeur: string } // identifiant d'activité
  | { type: "creneau"; valeur: string } // « MARDI-12 »
  | { type: "motif"; valeur: string }
  | { type: "attente"; valeur: string }; // identifiant d'activité

export const TYPES_COUPE = [
  "direction",
  "assiduite",
  "mois",
  "activite",
  "creneau",
  "motif",
  "attente",
] as const;

export type LigneAgentDetail = {
  userId: string;
  nom: string;
  situation: string | null; // service, à défaut direction
  venues: number;
  proposees: number;
  /** Null quand aucune séance ne lui a été proposée : on ne conclut pas. */
  taux: number | null;
};

export type LigneSeanceDetail = {
  id: string;
  date: Date;
  activite: string;
  couleur: string;
  creneau: string;
  statut: string;
  presents: number;
  absents: number;
  places: number;
  motif: string | null;
};

export type LigneInscriptionDetail = {
  id: string;
  userId: string;
  nom: string;
  situation: string | null;
  creneau: string;
  statut: string;
  rang: number | null;
  motif: string | null;
};

export type Detail = {
  titre: string;
  sousTitre: string;
  agents: LigneAgentDetail[];
  seances: LigneSeanceDetail[];
  inscriptions: LigneInscriptionDetail[];
};

/**
 * Assiduité agent par agent, sur le périmètre exact de `assiduite`.
 *
 * Les règles reprises telles quelles sont celles qui comptent : ne sont
 * proposées à un agent que les séances émargées de ses créneaux depuis son
 * inscription, et une venue hors de ce périmètre — participation ponctuelle,
 * séance antérieure — ne se compte pas au numérateur.
 */
async function assiduiteParAgent(f: Filtre): Promise<LigneAgentDetail[]> {
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
      select: {
        userId: true,
        creneauId: true,
        decisionAt: true,
        demandeAt: true,
        user: { select: { displayName: true, service: true, direction: true } },
      },
    }),
  ]);

  const emargees = seances.filter((s) => s.statut === "FAITE");
  const parCreneau = new Map<string, { id: string; date: Date }[]>();
  for (const s of emargees) {
    parCreneau.set(s.creneauId, [...(parCreneau.get(s.creneauId) ?? []), s]);
  }

  const proposees = new Map<string, number>();
  const perimetre = new Set<string>();
  const identites = new Map<string, { nom: string; situation: string | null }>();
  for (const i of inscriptions) {
    const siennes = (parCreneau.get(i.creneauId) ?? []).filter((s) =>
      participeALaSeance(i, s.date),
    );
    proposees.set(i.userId, (proposees.get(i.userId) ?? 0) + siennes.length);
    identites.set(i.userId, {
      nom: i.user.displayName,
      situation: i.user.service ?? i.user.direction,
    });
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

  return [...proposees.entries()]
    .map(([userId, nb]) => {
      const venu = venues.get(userId) ?? 0;
      const id = identites.get(userId);
      return {
        userId,
        nom: id?.nom ?? userId,
        situation: id?.situation ?? null,
        venues: venu,
        proposees: nb,
        taux: nb > 0 ? Math.round((venu / nb) * 100) : null,
      };
    })
    .sort((a, b) => (b.taux ?? -1) - (a.taux ?? -1) || a.nom.localeCompare(b.nom, "fr"));
}

/**
 * La bande d'assiduité d'un agent. Seuils identiques à ceux de `assiduite`,
 * y compris le cas de celui dont aucune séance n'a encore été émargée : il est
 * rangé avec les occasionnels et surtout pas parmi les « jamais venus », qui
 * déclenche une relance.
 */
function bande(l: LigneAgentDetail): string {
  if (l.proposees === 0) return "occasionnels";
  if (l.venues === 0) return "jamais";
  const part = l.venues / l.proposees;
  if (part >= 0.8) return "assidus";
  if (part >= 0.4) return "reguliers";
  return "occasionnels";
}

const STATUT_SEANCE: Record<string, string> = {
  PREVUE: "prévue",
  FAITE: "émargée",
  ANNULEE: "annulée",
};

type SeanceChargee = Awaited<ReturnType<typeof chargerSeances>>[number];

function decrireSeance(s: SeanceChargee): LigneSeanceDetail {
  return {
    id: s.id,
    date: s.date,
    activite: s.creneau.activite.nom,
    couleur: s.creneau.activite.couleur,
    creneau: `${JOUR_LABELS[s.creneau.jour]} ${s.creneau.heureDebut}–${s.creneau.heureFin}`,
    statut: STATUT_SEANCE[s.statut] ?? s.statut,
    presents: s.presences.filter((p) => estPresent(p.etat)).length,
    absents: s.presences.filter((p) => p.etat === "ABSENT").length,
    places: placesOffertes(s),
    motif: s.motifAnnulation ?? null,
  };
}

const BANDES: Record<string, [string, string]> = {
  assidus: ["Assidus", "80 % des séances proposées et plus"],
  reguliers: ["Réguliers", "de 40 à 80 % des séances proposées"],
  occasionnels: [
    "Occasionnels",
    "moins de 40 %, ou aucune séance encore émargée sur leurs créneaux",
  ],
  jamais: ["Jamais venus", "inscrits sans aucune présence"],
};

const VIDE = { agents: [], seances: [], inscriptions: [] };

/** Le détail d'une coupe : seules les listes qui ont un sens sont remplies. */
export async function detail(f: Filtre, coupe: Coupe): Promise<Detail> {
  if (coupe.type === "direction") {
    const seances = await chargerSeances(f);
    const compte = new Map<
      string,
      { nom: string; situation: string | null; venues: number }
    >();
    for (const s of seances) {
      if (s.statut !== "FAITE") continue;
      for (const p of s.presences) {
        if (!estPresent(p.etat)) continue;
        const cle = p.user.direction?.trim() || p.user.service?.trim() || "Non renseignée";
        if (cle !== coupe.valeur) continue;
        const courant = compte.get(p.userId) ?? {
          nom: p.user.displayName,
          situation: p.user.service ?? p.user.direction,
          venues: 0,
        };
        courant.venues += 1;
        compte.set(p.userId, courant);
      }
    }
    // Le taux vient de l'assiduité, pour que la fiche d'un agent et cet écran
    // annoncent la même chose.
    const parAgent = new Map((await assiduiteParAgent(f)).map((l) => [l.userId, l]));
    return {
      ...VIDE,
      titre: coupe.valeur,
      sousTitre: "Agents de cette direction venus au moins une fois",
      agents: [...compte.entries()]
        .map(([userId, c]) => ({
          userId,
          nom: c.nom,
          situation: c.situation,
          venues: c.venues,
          proposees: parAgent.get(userId)?.proposees ?? 0,
          taux: parAgent.get(userId)?.taux ?? null,
        }))
        .sort((a, b) => b.venues - a.venues || a.nom.localeCompare(b.nom, "fr")),
    };
  }

  if (coupe.type === "assiduite") {
    const [titre, sousTitre] = BANDES[coupe.valeur] ?? [coupe.valeur, ""];
    const tous = await assiduiteParAgent(f);
    return {
      ...VIDE,
      titre,
      sousTitre,
      agents: tous.filter((l) => bande(l) === coupe.valeur),
    };
  }

  if (coupe.type === "mois") {
    const seances = (await chargerSeances(f)).filter(
      (s) =>
        `${s.date.getFullYear()}-${String(s.date.getMonth() + 1).padStart(2, "0")}` ===
        coupe.valeur,
    );
    const [annee, mois] = coupe.valeur.split("-");
    const libelle = new Date(Number(annee), Number(mois) - 1, 1).toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric",
    });
    return {
      ...VIDE,
      titre: libelle.charAt(0).toUpperCase() + libelle.slice(1),
      sousTitre: "Séances de ce mois, émargées ou non",
      seances: seances.map(decrireSeance),
    };
  }

  if (coupe.type === "attente") {
    const activite = await prisma.activite.findUnique({
      where: { id: coupe.valeur },
      select: { nom: true },
    });
    const lignes = await prisma.inscription.findMany({
      where: {
        statut: { in: ["LISTE_ATTENTE", "EN_ATTENTE", "REFUSEE"] },
        creneau: { saisonId: f.saisonId, activiteId: coupe.valeur },
      },
      include: {
        user: { select: { displayName: true, service: true, direction: true } },
        creneau: true,
      },
      orderBy: [{ statut: "asc" }, { rang: "asc" }, { demandeAt: "asc" }],
    });
    return {
      ...VIDE,
      titre: activite?.nom ?? "Activité",
      sousTitre: "Demandes en file d'attente, à arbitrer, et refusées",
      inscriptions: lignes.map((i) => ({
        id: i.id,
        userId: i.userId,
        nom: i.user.displayName,
        situation: i.user.service ?? i.user.direction,
        creneau: `${JOUR_LABELS[i.creneau.jour]} ${i.creneau.heureDebut}–${i.creneau.heureFin}`,
        statut: i.statut,
        rang: i.rang,
        motif: i.motif,
      })),
    };
  }

  if (coupe.type === "activite") {
    const activite = await prisma.activite.findUnique({
      where: { id: coupe.valeur },
      select: { nom: true },
    });
    const cible: Filtre = { ...f, activiteId: coupe.valeur };
    return {
      ...VIDE,
      titre: activite?.nom ?? "Activité",
      sousTitre: "Séances de l'activité, et assiduité de ses inscrits",
      seances: (await chargerSeances(cible)).map(decrireSeance),
      agents: await assiduiteParAgent(cible),
    };
  }

  if (coupe.type === "creneau") {
    const [jour, heure] = coupe.valeur.split("-");
    const seances = (await chargerSeances(f)).filter(
      (s) =>
        s.creneau.jour === jour &&
        Number(s.creneau.heureDebut.slice(0, 2)) === Number(heure),
    );
    return {
      ...VIDE,
      titre: `${JOUR_LABELS[jour as Jour] ?? jour} ${String(heure).padStart(2, "0")} h`,
      sousTitre: "Séances programmées sur cette tranche horaire",
      seances: seances.map(decrireSeance),
    };
  }

  const seances = (await chargerSeances(f)).filter(
    (s) => s.statut === "ANNULEE" && (s.motifAnnulation ?? "Sans motif") === coupe.valeur,
  );
  return {
    ...VIDE,
    titre: coupe.valeur,
    sousTitre: "Séances annulées pour ce motif",
    seances: seances.map(decrireSeance),
  };
}
