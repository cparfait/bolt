import { prisma } from "./db";
import { PREFIXE_HORS_ANNUAIRE } from "./comptes";
import { servicesProposes } from "./services";

/**
 * Rapprochement des rattachements existants avec le référentiel.
 *
 * Poser une liste fermée sur le bon d'inscription ne règle que l'avenir. Les
 * comptes déjà créés portent ce qui a été tapé avant — « Dsi », « D.S.I »,
 * « service info » — et ce sont eux qui font diverger la fréquentation par
 * direction. Cet écran les rassemble et permet de les rattacher d'un geste.
 *
 * La distinction essentielle est celle du compte : hors annuaire ou pas.
 *
 *  • **Hors annuaire** (`no_ad.…`) : le service est saisi dans Bolt, il n'a pas
 *    d'autre source. Le corriger ici le corrige pour de bon.
 *  • **Annuaire** : le service vient de l'attribut `department` et la
 *    synchronisation le réécrit (src/lib/annuaire.ts). Le corriger dans Bolt
 *    tiendrait jusqu'à la nuit suivante. On l'affiche quand même — c'est une
 *    information utile, qui dit à la DSI ce qu'il y a à reprendre dans l'AD —
 *    mais on ne propose pas de le rattacher, ce qui serait mentir sur l'effet.
 */

export type Ecart = {
  /** Libellé porté par les comptes, absent du référentiel. */
  libelle: string;
  /** Comptes hors annuaire : rattachables ici. */
  horsAnnuaire: number;
  /** Comptes d'annuaire : à reprendre dans l'AD, pas dans Bolt. */
  annuaire: number;
};

/**
 * Libellés portés par au moins un compte et absents du référentiel actif.
 *
 * La comparaison est insensible à la casse : « DSI » présent au référentiel ne
 * doit pas faire ressortir « dsi » comme un écart à traiter — c'est le même
 * service, et le rattacher n'y changerait rien de visible. Ce qu'on cherche,
 * ce sont les libellés qui n'existent nulle part dans la liste.
 */
export async function ecartsDeRattachement(): Promise<Ecart[]> {
  const [referentiel, comptes] = await Promise.all([
    servicesProposes(),
    prisma.user.findMany({
      where: { service: { not: null }, active: true },
      select: { login: true, service: true },
    }),
  ]);
  return regrouperEcarts(comptes, referentiel);
}

/**
 * Le regroupement lui-même, séparé de sa lecture en base pour être testable.
 * C'est toute la logique de cet écran, et elle est invisible à la relecture :
 * on ne voit pas, en lisant, que « DSI » et « dsi » doivent compter pour un.
 */
export function regrouperEcarts(
  comptes: { login: string; service: string | null }[],
  referentiel: string[],
): Ecart[] {
  const connus = new Set(referentiel.map((s) => s.toLowerCase()));
  const parLibelle = new Map<string, Ecart>();

  for (const c of comptes) {
    const libelle = (c.service ?? "").trim();
    if (!libelle || connus.has(libelle.toLowerCase())) continue;
    const courant = parLibelle.get(libelle.toLowerCase()) ?? {
      libelle,
      horsAnnuaire: 0,
      annuaire: 0,
    };
    if (c.login.toLowerCase().startsWith(PREFIXE_HORS_ANNUAIRE)) {
      courant.horsAnnuaire += 1;
    } else {
      courant.annuaire += 1;
    }
    parLibelle.set(libelle.toLowerCase(), courant);
  }

  // Les plus nombreux d'abord : c'est là que le rapprochement rapporte le plus.
  return [...parLibelle.values()].sort(
    (a, b) =>
      b.horsAnnuaire + b.annuaire - (a.horsAnnuaire + a.annuaire) ||
      a.libelle.localeCompare(b.libelle, "fr"),
  );
}
