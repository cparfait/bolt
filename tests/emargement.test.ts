import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { absencesAReprendre, dateDeFormulaire } from "../src/lib/emargement";
import { etatApresEchecPin } from "../src/lib/coach-access";
import { isoDate } from "../src/lib/dates";

/**
 * Règles pures introduites par le lot B de l'audit : ce qui se décide à la
 * clôture d'une feuille, la lecture d'une date de formulaire, et le passage du
 * cinquième échec de PIN au verrou.
 */

describe("absencesAReprendre", () => {
  it("reprend l'absence annoncée d'un agent attendu et non pointé", () => {
    assert.deepEqual(
      absencesAReprendre({ annoncees: ["a"], pointes: [], attendus: ["a", "b"] }),
      ["a"],
    );
  });

  it("laisse tranquille l'agent que l'animateur a déjà pointé", () => {
    // Le constat de l'animateur prime sur l'intention annoncée : venu malgré
    // tout, il reste présent.
    assert.deepEqual(
      absencesAReprendre({ annoncees: ["a"], pointes: ["a"], attendus: ["a"] }),
      [],
    );
  });

  it("ignore l'agent désisté entre son annonce et la clôture (R7)", () => {
    // Il n'est plus sur la feuille : le compter absent lui créditait une
    // absence à une séance qui ne le concernait plus.
    assert.deepEqual(
      absencesAReprendre({ annoncees: ["a", "b"], pointes: [], attendus: ["b"] }),
      ["b"],
    );
  });

  it("ne reprend chaque agent qu'une fois", () => {
    assert.deepEqual(
      absencesAReprendre({ annoncees: ["a", "a"], pointes: [], attendus: ["a"] }),
      ["a"],
    );
  });
});

describe("dateDeFormulaire", () => {
  it("lit une date ISO de <input type=date>", () => {
    const d = dateDeFormulaire("2026-09-28");
    assert.ok(d);
    assert.equal(isoDate(d), "2026-09-28");
  });

  it("refuse ce qui n'a pas la forme AAAA-MM-JJ", () => {
    for (const v of ["", "28/09/2026", "2026-9-28", "demain", "2026-09-28T10:00"]) {
      assert.equal(dateDeFormulaire(v), null, v);
    }
  });

  it("refuse une date à la bonne forme mais invalide (S13)", () => {
    // « 2026-13-45 » passait la génération de séances puis Prisma renvoyait
    // une erreur 500 sur `Invalid Date`.
    assert.equal(dateDeFormulaire("2026-13-45"), null);
  });
});

describe("etatApresEchecPin", () => {
  it("compte les essais restants avant le cinquième", () => {
    assert.deepEqual(etatApresEchecPin(1), {
      verrouille: false,
      message: "Code incorrect (4 essais restants).",
      journal: "essai 1/5",
    });
    assert.equal(etatApresEchecPin(4).message, "Code incorrect (1 essai restant).");
  });

  it("verrouille au cinquième échec", () => {
    const e = etatApresEchecPin(5);
    assert.equal(e.verrouille, true);
    assert.match(e.message, /bloqué 15 minutes/);
    assert.match(e.journal, /^essai 5\/5/);
  });

  it("lit un compteur au-delà de la borne comme un verrou, jamais comme « -1 restant » (S4)", () => {
    // Des essais simultanés incrémentent tous le compteur en base : le
    // sixième et le septième doivent conclure au verrou, pas à un nombre
    // négatif d'essais restants.
    const e = etatApresEchecPin(7);
    assert.equal(e.verrouille, true);
    assert.doesNotMatch(e.message, /-/);
  });
});
