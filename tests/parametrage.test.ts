import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lireParametrage } from "../src/lib/parametrage";

const fichier = (contenu: object) => JSON.stringify({ version: 1, ...contenu });

describe("lecture d'un paramétrage", () => {
  it("lit le référentiel dans son ordre et les regroupements", () => {
    const p = lireParametrage(
      fichier({
        referentiel: [{ nom: "Petite Enfance" }, { nom: "Sports", actif: false }],
        regroupements: [{ source: "Crêche Sablons", cible: "Petite Enfance" }],
      }),
    );
    assert.deepEqual(p.referentiel, [
      { nom: "Petite Enfance", actif: true },
      { nom: "Sports", actif: false },
    ]);
    assert.deepEqual(p.regroupements, [{ source: "Crêche Sablons", cible: "Petite Enfance" }]);
    assert.deepEqual(p.exclusionsSync, []);
  });

  it("écarte les doublons de graphie et garde la première orthographe", () => {
    const p = lireParametrage(
      fichier({
        referentiel: [{ nom: "Petite Enfance" }, { nom: "petite enfance" }, { nom: " Sports " }],
        regroupements: [],
      }),
    );
    assert.deepEqual(
      p.referentiel.map((r) => r.nom),
      ["Petite Enfance", "Sports"],
    );
  });

  it("ramène la cible d'une règle à l'orthographe du référentiel", () => {
    const p = lireParametrage(
      fichier({
        referentiel: [{ nom: "Petite Enfance" }],
        regroupements: [{ source: "Crèche Sablons", cible: "petite enfance" }],
      }),
    );
    assert.equal(p.regroupements[0].cible, "Petite Enfance");
  });

  it("refuse une règle dont la cible n'est pas au référentiel", () => {
    assert.throws(
      () =>
        lireParametrage(
          fichier({
            referentiel: [{ nom: "Sports" }],
            regroupements: [{ source: "CTM", cible: "Centre Technique municipal" }],
          }),
        ),
      /absent du référentiel/,
    );
  });

  it("refuse une autre version et un fichier mal formé", () => {
    assert.throws(() => lireParametrage("{"), /JSON/);
    assert.throws(
      () => lireParametrage(JSON.stringify({ version: 2, referentiel: [], regroupements: [] })),
      /Version/,
    );
    assert.throws(() => lireParametrage(fichier({ referentiel: [] })), /referentiel/);
  });
});
