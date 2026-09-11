import type { Jour } from "@prisma/client";
import { prisma } from "./db";
import { JOUR_LABELS, cleMois, fmtDate } from "./dates";
import { SEANCE_STATUT_LABELS, pluriel } from "./constants";
import {
  assiduiteParAgent,
  bandeAssiduite,
  bilanSeance,
  chargerSeances,
  cleDirection,
  cleService,
  estPresent,
  motifNormalise,
  placesOffertes,
  type Filtre,
  type SeanceChargee,
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
  | { type: "service"; valeur: string }
  | { type: "assiduite"; valeur: string } // assidus | reguliers | occasionnels | jamais
  | { type: "mois"; valeur: string } // « 2026-09 »
  | { type: "activite"; valeur: string } // identifiant d'activité
  | { type: "creneau"; valeur: string } // « MARDI-12 »
  | { type: "motif"; valeur: string }
  | { type: "attente"; valeur: string } // identifiant d'activité
  | { type: "promotion"; valeur: string }; // « rendues » | « toutes »

export const TYPES_COUPE = [
  "direction",
  "service",
  "assiduite",
  "mois",
  "activite",
  "creneau",
  "motif",
  "attente",
  "promotion",
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
  /**
   * Ce que le tableau des demandes ne dit pas de lui-même : quel périmètre il
   * couvre. La phrase dépend de la coupe — « hors inscriptions validées » est
   * vrai d'une file d'attente et faux de places rendues, qui étaient validées
   * jusqu'à la veille. Elle vit donc ici, avec la requête qui la justifie,
   * plutôt qu'en dur sous le tableau.
   */
  noteInscriptions?: string;
};

/**
 * Assiduité agent par agent, sur le périmètre exact de `assiduite` : le calcul
 * est le même (`assiduiteParAgent`, src/lib/stats.ts), seule l'identité s'y
 * ajoute pour l'affichage.
 */
async function assiduiteDetaillee(f: Filtre): Promise<LigneAgentDetail[]> {
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

  const identites = new Map(
    inscriptions.map((i) => [
      i.userId,
      { nom: i.user.displayName, situation: i.user.service ?? i.user.direction },
    ]),
  );

  return [...assiduiteParAgent(seances, inscriptions).entries()]
    .map(([userId, a]) => {
      const id = identites.get(userId);
      return {
        userId,
        nom: id?.nom ?? userId,
        situation: id?.situation ?? null,
        venues: a.venues,
        proposees: a.proposees,
        taux: a.proposees > 0 ? Math.round((a.venues / a.proposees) * 100) : null,
      };
    })
    .sort((a, b) => (b.taux ?? -1) - (a.taux ?? -1) || a.nom.localeCompare(b.nom, "fr"));
}

function decrireSeance(s: SeanceChargee): LigneSeanceDetail {
  // Présents et absents selon la formule du bilan (`bilanSeance`) : un absent
  // est un attendu non venu, pointé ou non, et la ligne de détail doit
  // recomposer le chiffre sur lequel on a cliqué.
  const b = bilanSeance(s);
  return {
    id: s.id,
    date: s.date,
    activite: s.creneau.activite.nom,
    couleur: s.creneau.activite.couleur,
    creneau: `${JOUR_LABELS[s.creneau.jour]} ${s.creneau.heureDebut}–${s.creneau.heureFin}`,
    // Le libellé commun à toute l'application, en minuscule : il se glisse
    // après la date, en petit. Une table locale ignorait « PLANIFIEE ».
    statut: SEANCE_STATUT_LABELS[s.statut].toLocaleLowerCase("fr"),
    presents: b.presents,
    absents: b.absents,
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
        if (cleDirection(p.user) !== coupe.valeur) continue;
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
    const parAgent = new Map((await assiduiteDetaillee(f)).map((l) => [l.userId, l]));
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
    const tous = await assiduiteDetaillee(f);
    return {
      ...VIDE,
      titre,
      sousTitre,
      agents: tous.filter((l) => bandeAssiduite(l) === coupe.valeur),
    };
  }

  if (coupe.type === "mois") {
    // Les séances émargées seulement, et la clé de mois en UTC : c'est ce que
    // compte la barre de l'histogramme (`agregerMensuel`), et une liste qui
    // ajoute les séances annulées ou à venir ne recompose plus son chiffre.
    const seances = (await chargerSeances(f)).filter(
      (s) => s.statut === "FAITE" && cleMois(s.date) === coupe.valeur,
    );
    const [annee, mois] = coupe.valeur.split("-");
    const libelle = new Date(Number(annee), Number(mois) - 1, 1).toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric",
    });
    return {
      ...VIDE,
      titre: libelle.charAt(0).toUpperCase() + libelle.slice(1),
      sousTitre: "Séances émargées ce mois-ci",
      seances: seances.map(decrireSeance),
    };
  }

  if (coupe.type === "service") {
    // Les inscrits, et non les présents : cette coupe répond au tableau
    // « Inscriptions par service », qui compte des agents inscrits. Lister ici
    // ceux qui sont venus donnerait un nombre plus petit que celui sur lequel
    // on a cliqué.
    const lignes = await prisma.inscription.findMany({
      where: {
        statut: "VALIDEE",
        creneau: {
          saisonId: f.saisonId,
          ...(f.activiteId ? { activiteId: f.activiteId } : {}),
        },
      },
      include: {
        user: { select: { displayName: true, service: true, direction: true } },
        creneau: true,
      },
      orderBy: [{ demandeAt: "asc" }],
    });
    const duService = lignes.filter((i) => cleService(i.user) === coupe.valeur);
    const agents = new Set(duService.map((i) => i.userId)).size;
    return {
      ...VIDE,
      titre: coupe.valeur,
      sousTitre: "Agents de ce service inscrits cette saison",
      noteInscriptions: `${agents} ${pluriel(agents, "agent")} pour ${duService.length} ${pluriel(duService.length, "inscription")}.`,
      inscriptions: duService.map((i) => ({
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
      noteInscriptions: `${lignes.length} ${pluriel(lignes.length, "demande")} sur cette activité, hors inscriptions validées.`,
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

  if (coupe.type === "promotion") {
    // Les places attribuées depuis la liste d'attente, et ce qu'elles sont
    // devenues. « rendues » ne garde que celles refusées dans la foulée : c'est
    // le chiffre qui pose question, et la liste répond « par qui, et quand ».
    const rendues = coupe.valeur === "rendues";
    const lignes = await prisma.inscription.findMany({
      where: {
        promuAt: { not: null },
        ...(rendues ? { statut: "DESISTEE" as const } : {}),
        creneau: {
          saisonId: f.saisonId,
          ...(f.activiteId ? { activiteId: f.activiteId } : {}),
        },
      },
      include: {
        user: { select: { displayName: true, service: true, direction: true } },
        creneau: { include: { activite: { select: { nom: true } } } },
      },
      orderBy: { promuAt: "desc" },
    });
    return {
      ...VIDE,
      titre: rendues ? "Places rendues après promotion" : "Promotions depuis la liste d'attente",
      sousTitre: rendues
        ? "Agents qui ont refusé la place obtenue en attendant leur tour"
        : "Places libérées attribuées au premier de la file",
      noteInscriptions: rendues
        ? "La place est repartie au suivant dès le refus. Une part élevée signale une file où l'on attend trop longtemps, pas des agents peu fiables."
        : "Places attribuées automatiquement à la personne en tête de file, quel que soit ce qu'elle en a fait ensuite.",
      inscriptions: lignes.map((i) => ({
        id: i.id,
        userId: i.userId,
        nom: i.user.displayName,
        situation: i.user.service ?? i.user.direction,
        creneau: `${i.creneau.activite.nom} — ${JOUR_LABELS[i.creneau.jour]} ${i.creneau.heureDebut}–${i.creneau.heureFin} · promu le ${fmtDate(i.promuAt)}`,
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
      sousTitre:
        "Toutes les séances de l'activité, émargées ou non, et assiduité de ses inscrits",
      seances: (await chargerSeances(cible)).map(decrireSeance),
      agents: await assiduiteDetaillee(cible),
    };
  }

  if (coupe.type === "creneau") {
    const [jour, heure] = coupe.valeur.split("-");
    // Émargées seulement : la case de la grille ne moyenne que celles-là.
    const seances = (await chargerSeances(f)).filter(
      (s) =>
        s.statut === "FAITE" &&
        s.creneau.jour === jour &&
        Number(s.creneau.heureDebut.slice(0, 2)) === Number(heure),
    );
    return {
      ...VIDE,
      titre: `${JOUR_LABELS[jour as Jour] ?? jour} ${String(heure).padStart(2, "0")} h`,
      sousTitre: "Séances émargées sur cette tranche horaire",
      seances: seances.map(decrireSeance),
    };
  }

  // Même normalisation que le compteur des motifs, sans quoi « Motif non
  // renseigné » menait à une page vide.
  const seances = (await chargerSeances(f)).filter(
    (s) => s.statut === "ANNULEE" && motifNormalise(s.motifAnnulation) === coupe.valeur,
  );
  return {
    ...VIDE,
    titre: coupe.valeur,
    sousTitre: "Séances annulées pour ce motif",
    seances: seances.map(decrireSeance),
  };
}
