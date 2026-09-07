import { prisma } from "./db";
import { cleComparaison, normaliser, parNom } from "./services";

/**
 * Paramétrage des services, transportable d'un outil à l'autre.
 *
 * Le format est celui de cybermois (`npm run parametrage -- exporter`) : un
 * fichier JSON qui porte le référentiel dans son ordre, et les regroupements
 * « ce libellé d'annuaire désigne ce service ». C'est ce fichier, et non une
 * liste dans le code, qui fait que tous les outils de la collectivité parlent
 * des mêmes services : on l'exporte de l'un, on l'importe dans l'autre, et
 * chacun reste modifiable dans son administration.
 *
 * Les deux autres sections de cybermois (`exclusionsSync`, `agents`) n'ont pas
 * d'équivalent ici. Elles sont ignorées à la lecture et exportées vides, pour
 * que cybermois accepte en retour un fichier produit par Bolt.
 */

export const VERSION_PARAMETRAGE = 1;

export type Parametrage = {
  version: number;
  collectivite?: string;
  note?: string;
  referentiel: { nom: string; actif: boolean }[];
  regroupements: { source: string; cible: string }[];
  exclusionsSync: unknown[];
  agents: unknown[];
};

/**
 * Lit et vérifie un fichier de paramétrage. Lève une erreur en français,
 * destinée à l'écran : le fichier vient d'une personne, pas d'un programme.
 *
 * Les doublons de graphie sont écartés, la première occurrence gagne. Une
 * règle dont la cible n'est pas au référentiel est refusée : l'appliquer
 * rattacherait des comptes à un service qui n'existe pas.
 */
export function lireParametrage(texte: string): Parametrage {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    throw new Error("Ce fichier n'est pas du JSON valide.");
  }
  if (!brut || typeof brut !== "object") throw new Error("Fichier de paramétrage vide.");
  const p = brut as Record<string, unknown>;
  if (p.version !== VERSION_PARAMETRAGE) {
    throw new Error(
      `Version de paramétrage ${String(p.version)} non prise en charge (attendu ${VERSION_PARAMETRAGE}).`,
    );
  }
  if (!Array.isArray(p.referentiel) || !Array.isArray(p.regroupements)) {
    throw new Error("Le fichier doit contenir « referentiel » et « regroupements ».");
  }

  const referentiel: Parametrage["referentiel"] = [];
  const vus = new Map<string, string>();
  for (const ligne of p.referentiel as unknown[]) {
    const nom = normaliser(typeof ligne === "string" ? ligne : (ligne as { nom?: unknown })?.nom as string);
    const cle = cleComparaison(nom);
    if (!cle || nom.length < 2 || nom.length > 120 || vus.has(cle)) continue;
    const actif = (ligne as { actif?: unknown })?.actif;
    vus.set(cle, nom);
    referentiel.push({ nom, actif: actif === undefined ? true : Boolean(actif) });
  }
  if (referentiel.length === 0) throw new Error("Le référentiel du fichier est vide.");

  const regroupements: Parametrage["regroupements"] = [];
  const sources = new Set<string>();
  const inconnues: string[] = [];
  for (const ligne of p.regroupements as unknown[]) {
    const r = ligne as { source?: unknown; cible?: unknown };
    const source = normaliser(String(r?.source ?? ""));
    const cle = cleComparaison(source);
    if (!cle || sources.has(cle)) continue;
    const cible = vus.get(cleComparaison(String(r?.cible ?? "")));
    if (!cible) {
      inconnues.push(`${source} → ${normaliser(String(r?.cible ?? ""))}`);
      continue;
    }
    sources.add(cle);
    regroupements.push({ source, cible });
  }
  if (inconnues.length > 0) {
    throw new Error(
      `${inconnues.length} regroupement(s) visent un service absent du référentiel du fichier : ${inconnues
        .slice(0, 3)
        .join(" ; ")}${inconnues.length > 3 ? " ; …" : ""}`,
    );
  }

  return {
    version: VERSION_PARAMETRAGE,
    collectivite: typeof p.collectivite === "string" ? p.collectivite : undefined,
    note: typeof p.note === "string" ? p.note : undefined,
    referentiel,
    regroupements,
    exclusionsSync: [],
    agents: [],
  };
}

/** Le paramétrage courant, tel qu'on l'exporte. */
export async function exporterParametrage(): Promise<Parametrage> {
  const [services, regroupements] = await Promise.all([
    prisma.service.findMany({ select: { nom: true, actif: true } }),
    prisma.regroupementService.findMany({
      orderBy: [{ cible: "asc" }, { source: "asc" }],
      select: { source: true, cible: true },
    }),
  ]);
  return {
    version: VERSION_PARAMETRAGE,
    note: `Bolt — référentiel des services et regroupements, exporté le ${new Date().toLocaleDateString("fr-FR")}`,
    referentiel: [...services].sort((a, b) => parNom(a.nom, b.nom)),
    regroupements,
    exclusionsSync: [],
    agents: [],
  };
}
