import { prisma } from "./db";
import { PREFIXE_HORS_ANNUAIRE } from "./comptes";
import { cleComparaison, servicesProposes } from "./services";

/**
 * Rapprochement d'un libellé d'annuaire avec un service du référentiel.
 *
 * L'égalité stricte ne suffit pas : les deux listes sont écrites par des
 * personnes différentes, à des années d'intervalle. « CTM » et « Centre
 * technique municipal » désignent le même service sans partager un caractère,
 * « Jeunesse » et « Service jeunesse » ne diffèrent que d'un mot vide de sens.
 *
 * On combine donc plusieurs indices, chacun répondant à un cas observé :
 *
 *   sigle            CTM               → Centre technique municipal
 *   inclusion        Jeunesse          → Service jeunesse
 *   mots partagés    Marchés publics   → Achats et commande publique (faible)
 *
 * Chaque proposition sort avec un niveau de confiance : une suggestion fausse
 * présentée comme sûre coûte plus cher que pas de suggestion du tout — elle
 * fait basculer trente agents dans le mauvais service, et personne ne le
 * remarque avant le bilan de fin de saison.
 */

// Mots trop fréquents pour distinguer deux services : les compter ferait
// ressembler « Service jeunesse » à « Service technique ».
const MOTS_VIDES = new Set([
  "de", "du", "des", "la", "le", "les", "et", "a", "au", "aux", "en", "d", "l",
  "service", "services", "direction", "pole", "poles", "son", "sa", "ses",
  "avec", "pour", "sur", "par",
]);

const mots = (texte: string) => cleComparaison(texte).split(" ").filter(Boolean);
const motsUtiles = (texte: string) => mots(texte).filter((m) => !MOTS_VIDES.has(m));

/** Initiales des mots significatifs : « Centre technique municipal » → ctm */
function sigle(texte: string): string {
  const m = motsUtiles(texte);
  return m.length >= 2 ? m.map((x) => x[0]).join("") : "";
}

/**
 * Pondère chaque mot par sa rareté dans le référentiel : « urbaine » vaut plus
 * que « générale », qui revient partout.
 */
function poids(referentiel: string[]): (mot: string) => number {
  const frequence = new Map<string, number>();
  for (const r of referentiel) {
    for (const m of new Set(motsUtiles(r))) {
      frequence.set(m, (frequence.get(m) ?? 0) + 1);
    }
  }
  const total = referentiel.length || 1;
  return (mot) => Math.log(1 + total / (1 + (frequence.get(mot) ?? 0)));
}

/** Distance de Levenshtein bornée, pour rattraper une faute de frappe. */
function proche(a: string, b: string, tolerance = 2): boolean {
  if (Math.abs(a.length - b.length) > tolerance) return false;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let precedent = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tampon = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, precedent + (a[i - 1] === b[j - 1] ? 0 : 1));
      precedent = tampon;
    }
  }
  return d[b.length] <= tolerance;
}

export type Score = { score: number; motif: string | null };

/**
 * Score de 0 à 100 entre un libellé et un service.
 * Les règles sont ordonnées de la plus sûre à la plus fragile.
 */
export function scorer(
  libelle: string,
  service: string,
  peser: (mot: string) => number,
): Score {
  const cl = cleComparaison(libelle);
  const cs = cleComparaison(service);
  if (!cl || !cs) return { score: 0, motif: null };

  if (cl === cs) return { score: 100, motif: "libellés identiques" };

  // « Jeunesse » dans « Service jeunesse », ou l'inverse
  if (cl.startsWith(`${cs} `) || cl.endsWith(` ${cs}`) || cl.includes(` ${cs} `)) {
    return { score: 92, motif: `« ${service} » est contenu dans le libellé` };
  }
  if (cs.startsWith(`${cl} `) || cs.endsWith(` ${cl}`) || cs.includes(` ${cl} `)) {
    return { score: 88, motif: `le libellé est contenu dans « ${service} »` };
  }

  // Sigle : CTM → Centre technique municipal
  const s = sigle(service);
  if (s && s.length >= 2 && cl.replace(/ /g, "") === s) {
    return { score: 90, motif: `sigle de « ${service} »` };
  }
  const sl = sigle(libelle);
  if (sl && sl.length >= 2 && cs.replace(/ /g, "") === sl) {
    return { score: 86, motif: `« ${service} » est le sigle du libellé` };
  }

  const ml = motsUtiles(libelle);
  const ms = motsUtiles(service);
  if (!ml.length || !ms.length) return { score: 0, motif: null };

  // Mots partagés, pondérés par leur rareté
  const ensembleS = new Set(ms);
  let commun = 0;
  let totalL = 0;
  const partages: string[] = [];
  for (const m of new Set(ml)) {
    const p = peser(m);
    totalL += p;
    if (ensembleS.has(m)) {
      commun += p;
      partages.push(m);
      continue;
    }
    // Faute de frappe ou variante : « administation » / « administration »
    const voisin = ms.find((x) => x.length > 5 && proche(m, x));
    if (voisin) {
      commun += p * 0.85;
      partages.push(m);
    }
  }
  if (!commun) return { score: 0, motif: null };

  const totalS = ms.reduce((n, m) => n + peser(m), 0);
  // Moyenne harmonique : un libellé long qui partage un mot avec un service
  // court ne doit pas obtenir un score élevé.
  const couvertureL = commun / totalL;
  const couvertureS = commun / totalS;
  const harmonique = (2 * couvertureL * couvertureS) / (couvertureL + couvertureS);

  return {
    score: Math.round(harmonique * 80),
    motif: `mots en commun : ${partages.join(", ")}`,
  };
}

export type Confiance = "sure" | "probable" | "incertaine" | "aucune";

export type Suggestion = {
  libelle: string;
  /** Comptes hors annuaire portant ce libellé : rattachables ici. */
  horsAnnuaire: number;
  /** Comptes d'annuaire : leur libellé vient de l'AD, la règle les suivra. */
  annuaire: number;
  confiance: Confiance;
  ambigu: boolean;
  proposition: string | null;
  motif: string | null;
  score: number;
  candidats: { service: string; score: number; motif: string | null }[];
};

export type Libelle = { libelle: string; horsAnnuaire: number; annuaire: number };

/**
 * Propose, pour chaque libellé, les meilleurs services du référentiel.
 *
 * Les seuils sont volontairement prudents : mieux vaut ne rien proposer que de
 * faire basculer trente agents dans le mauvais service.
 */
export function rapprocher(
  libelles: Libelle[],
  referentiel: string[],
  { maximum = 3 }: { maximum?: number } = {},
): Suggestion[] {
  const peser = poids(referentiel);

  return libelles.map((l) => {
    const candidats = referentiel
      .map((service) => ({ service, ...scorer(l.libelle, service, peser) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maximum);

    const meilleur = candidats[0] ?? null;
    const second = candidats[1] ?? null;

    // Un écart faible entre les deux premiers signale une ambiguïté réelle :
    // « Maison des arts » hésite entre plusieurs « Maison des … ».
    const ambigu = Boolean(meilleur && second && meilleur.score - second.score < 8);

    let confiance: Confiance = "aucune";
    if (meilleur) {
      if (meilleur.score >= 85 && !ambigu) confiance = "sure";
      else if (meilleur.score >= 60) confiance = "probable";
      else if (meilleur.score >= 35) confiance = "incertaine";
    }

    return {
      libelle: l.libelle,
      horsAnnuaire: l.horsAnnuaire,
      annuaire: l.annuaire,
      confiance,
      ambigu,
      proposition: confiance === "aucune" ? null : meilleur!.service,
      motif: meilleur?.motif ?? null,
      score: meilleur?.score ?? 0,
      candidats,
    };
  });
}

/**
 * Inventaire des libellés bruts en usage et absents du référentiel.
 *
 * Le libellé BRUT, et non le service affiché : c'est lui que les règles
 * prennent en entrée, et c'est sur lui que le rapprochement doit porter pour
 * rester rejouable.
 *
 * Tout l'annuaire synchronisé, pas seulement les comptes Bolt : le
 * rapprochement se prépare AVANT la rentrée, quand personne ne s'est encore
 * connecté, et c'est à ce moment qu'on veut voir les libellés de l'AD qui
 * n'entrent pas dans le référentiel. Les comptes de l'annuaire viennent du
 * miroir (`AdAccount.service`, comptes activés) ; s'y ajoutent les comptes
 * Bolt qui n'y figurent pas — participants hors annuaire, comptes locaux —,
 * avec leur propre libellé.
 */
export async function inventaireLibelles(): Promise<Libelle[]> {
  const [referentiel, comptes, miroir, regles] = await Promise.all([
    servicesProposes(),
    prisma.user.findMany({
      where: { active: true, serviceForce: false },
      select: { login: true, service: true },
    }),
    prisma.adAccount.findMany({
      where: { enabled: true },
      select: { samAccountName: true, service: true },
    }),
    prisma.regroupementService.findMany({ select: { source: true } }),
  ]);

  const dansMiroir = new Set(miroir.map((m) => m.samAccountName.toLowerCase()));
  return regrouperLibelles(
    [
      ...miroir.map((m) => ({ login: m.samAccountName, brut: m.service })),
      ...comptes
        .filter((c) => !dansMiroir.has(c.login.toLowerCase()))
        .map((c) => ({ login: c.login, brut: c.service })),
    ],
    referentiel,
    regles.map((r) => r.source),
  );
}

/**
 * Le regroupement lui-même, séparé de sa lecture en base pour être testable.
 * C'est toute la logique de cet écran, et elle est invisible à la relecture :
 * on ne voit pas, en lisant, que « DSI » et « dsi » doivent compter pour un.
 */
export function regrouperLibelles(
  comptes: { login: string; brut: string | null }[],
  referentiel: string[],
  /** Sources déjà couvertes par une règle : rattachées, donc plus à proposer. */
  regles: Iterable<string> = [],
): Libelle[] {
  const connus = new Set([...referentiel, ...regles].map(cleComparaison));
  const parLibelle = new Map<string, Libelle>();

  for (const c of comptes) {
    const libelle = (c.brut ?? "").trim();
    const cle = cleComparaison(libelle);
    if (!cle || connus.has(cle)) continue;
    const courant = parLibelle.get(cle) ?? { libelle, horsAnnuaire: 0, annuaire: 0 };
    if (c.login.toLowerCase().startsWith(PREFIXE_HORS_ANNUAIRE)) courant.horsAnnuaire += 1;
    else courant.annuaire += 1;
    parLibelle.set(cle, courant);
  }

  // Les plus nombreux d'abord : c'est là que le rapprochement rapporte le plus.
  return [...parLibelle.values()].sort(
    (a, b) =>
      b.horsAnnuaire + b.annuaire - (a.horsAnnuaire + a.annuaire) ||
      a.libelle.localeCompare(b.libelle, "fr"),
  );
}
