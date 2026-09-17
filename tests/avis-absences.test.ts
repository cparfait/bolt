import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { avisDu, serieDAbsences } from "../src/lib/avis-absences";

/**
 * Qui reçoit le courriel « on ne vous voit plus », et quand.
 *
 * La règle décide d'écrire à quelqu'un pour lui dire qu'il ne vient plus : se
 * tromper, c'est écrire à un agent assidu — ou écrire trois fois à celui qui a
 * décroché. Aucune des deux erreurs ne se voit dans l'application.
 */

const seance = (id: string, present: boolean) => ({ id, present });

describe("serieDAbsences — la série en cours, de la plus récente à la plus ancienne", () => {
  it("compte les absences jusqu'à la première présence", () => {
    assert.deepEqual(
      serieDAbsences([seance("s5", false), seance("s4", false), seance("s3", true), seance("s2", false)]),
      ["s5", "s4"],
    );
  });

  it("est vide dès que la dernière séance a été suivie", () => {
    assert.deepEqual(serieDAbsences([seance("s5", true), seance("s4", false)]), []);
  });

  it("est vide sans séance émargée", () => {
    assert.deepEqual(serieDAbsences([]), []);
  });

  it("remonte toute l'histoire d'un agent jamais venu", () => {
    assert.deepEqual(serieDAbsences([seance("s3", false), seance("s2", false), seance("s1", false)]), [
      "s3",
      "s2",
      "s1",
    ]);
  });
});

describe("avisDu — un avis par série, au seuil", () => {
  it("attend que le seuil soit atteint", () => {
    assert.equal(avisDu(["s5", "s4"], 3, []), false);
    assert.equal(avisDu(["s5", "s4", "s3"], 3, []), true);
  });

  it("ne prévient pas deux fois pour la même série, même si elle s'allonge", () => {
    assert.equal(avisDu(["s6", "s5", "s4", "s3"], 3, [{ seanceId: "s5" }]), false);
  });

  it("prévient à nouveau quand une nouvelle série commence après un retour", () => {
    // Prévenu pour la série s1–s3, revenu en s4, puis absent en s5–s7.
    assert.equal(avisDu(["s7", "s6", "s5"], 3, [{ seanceId: "s3" }]), true);
  });

  it("ne fait rien avec un seuil absurde", () => {
    assert.equal(avisDu(["s3", "s2", "s1"], 0, []), false);
  });
});
