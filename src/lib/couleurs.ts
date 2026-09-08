/**
 * Écrire sur une couleur qu'on ne choisit pas.
 *
 * Les activités portent une couleur libre, saisie par le service des sports :
 * rien ne garantit qu'elle soit sombre. Poser du texte blanc dessus « parce que
 * les autres sont sombres » finit par produire un bouton jaune pâle au libellé
 * blanc — illisible, et invisible tant que personne n'a créé cette activité-là.
 *
 * On tranche donc au cas par cas, sur la luminance relative de la couleur.
 */

/** « #7c3aed » ou « #abc » → composantes 0–255. Null si la chaîne n'en est pas une. */
function composantes(hex: string): [number, number, number] | null {
  const brut = hex.trim().replace(/^#/, "");
  const complet =
    brut.length === 3
      ? brut
          .split("")
          .map((c) => c + c)
          .join("")
      : brut;
  if (!/^[0-9a-fA-F]{6}$/.test(complet)) return null;
  return [
    parseInt(complet.slice(0, 2), 16),
    parseInt(complet.slice(2, 4), 16),
    parseInt(complet.slice(4, 6), 16),
  ];
}

/**
 * Luminance relative, au sens WCAG : ce que l'œil perçoit comme « clair », qui
 * n'est pas la moyenne des composantes — le vert pèse pour près des trois
 * quarts, le bleu pour un quinzième. Un bleu vif est sombre à l'œil, un jaune
 * vif est clair, et une moyenne arithmétique se tromperait sur les deux.
 */
function luminance([r, v, b]: [number, number, number]): number {
  const canal = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(v) + 0.0722 * canal(b);
}

/** Encre lisible sur un aplat de cette couleur : blanc, ou le gris d'encre. */
export function texteSur(couleur: string): string {
  const rvb = composantes(couleur);
  // Couleur illisible : on suppose un fond sombre, comme le reste de la
  // palette. Le défaut de l'application (#4f46e5) l'est, et une valeur
  // aberrante en base ne doit pas faire disparaître le libellé.
  if (!rvb) return "#ffffff";
  // Seuil à 0,45 plutôt qu'au 0,5 théorique : entre les deux, le blanc reste
  // plus lisible que le gris foncé sur les teintes moyennes — un vert d'eau, un
  // orange — parce que le texte y est en gras et de petite taille.
  return luminance(rvb) > 0.45 ? "#0f172a" : "#ffffff";
}
