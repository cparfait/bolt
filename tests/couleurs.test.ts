import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { texteSur } from "../src/lib/couleurs";

/**
 * Encre lisible sur une couleur qu'on ne choisit pas.
 *
 * Les activités portent une couleur libre : le défaut est sombre, et tous les
 * exemples livrés le sont aussi. Une collectivité qui choisira un jaune ou un
 * vert d'eau pour son activité découvrira le défaut sur son écran, pas ici —
 * d'où ces cas, qui sont précisément ceux que personne n'a sous les yeux.
 */

describe("encre sur un aplat de couleur", () => {
  it("écrit en blanc sur les teintes sombres, y compris un bleu vif", () => {
    for (const couleur of ["#7c3aed", "#4f46e5", "#059669", "#0891b2", "#db2777", "#000000"]) {
      assert.equal(texteSur(couleur), "#ffffff", couleur);
    }
  });

  it("écrit en sombre sur les teintes claires", () => {
    // Un jaune vif est clair à l'œil bien qu'il soit « saturé » : c'est ce que
    // la luminance relative capte et qu'une moyenne des composantes manquerait.
    for (const couleur of ["#facc15", "#ffffff", "#a7f3d0", "#fde68a"]) {
      assert.equal(texteSur(couleur), "#0f172a", couleur);
    }
  });

  it("accepte la notation courte et l'absence de dièse", () => {
    assert.equal(texteSur("#fff"), "#0f172a");
    assert.equal(texteSur("000"), "#ffffff");
    assert.equal(texteSur("  #FACC15  "), "#0f172a");
  });

  it("retombe sur le blanc quand la couleur est illisible", () => {
    // Une valeur aberrante en base ne doit pas faire disparaître le libellé :
    // le reste de la palette étant sombre, le blanc est le pari le moins mauvais.
    for (const brut of ["", "bleu", "#12345", "rgb(1,2,3)"]) {
      assert.equal(texteSur(brut), "#ffffff", JSON.stringify(brut));
    }
  });
});
