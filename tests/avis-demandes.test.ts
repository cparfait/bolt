import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { creneauEchu } from "../src/lib/demandes";

/**
 * Rythme des avis « des demandes attendent ».
 *
 * Toute la logique tient dans cette fonction, et elle est invisible à la
 * relecture : on ne voit pas, en lisant le code, qu'un redémarrage à 12 h 03 ne
 * doit pas sauter le créneau de midi. C'est le genre de défaut qui ne se
 * remarque qu'en constatant, des semaines plus tard, que personne n'a été
 * prévenu.
 */

const le = (jour: number, heure: number, minute = 0) =>
  new Date(2026, 8, jour, heure, minute); // septembre 2026 : le 7 est un lundi

describe("quatre fois par jour (9, 12, 14, 16)", () => {
  it("ne déclenche rien avant le premier créneau", () => {
    assert.equal(creneauEchu(le(8, 7), "QUATRE_JOUR"), null);
    assert.equal(creneauEchu(le(8, 8, 59), "QUATRE_JOUR"), null);
  });

  it("retient le dernier créneau passé, pas l'heure exacte", () => {
    // L'ordonnanceur bat toutes les cinq minutes : exiger l'heure pile ferait
    // rater le créneau à chaque redémarrage tombé au mauvais moment.
    assert.equal(creneauEchu(le(8, 9, 0), "QUATRE_JOUR"), "2026-09-08#09");
    assert.equal(creneauEchu(le(8, 9, 58), "QUATRE_JOUR"), "2026-09-08#09");
    assert.equal(creneauEchu(le(8, 11, 59), "QUATRE_JOUR"), "2026-09-08#09");
  });

  it("passe au créneau suivant une fois l'heure atteinte", () => {
    assert.equal(creneauEchu(le(8, 12, 3), "QUATRE_JOUR"), "2026-09-08#12");
    assert.equal(creneauEchu(le(8, 14, 30), "QUATRE_JOUR"), "2026-09-08#14");
    assert.equal(creneauEchu(le(8, 23, 59), "QUATRE_JOUR"), "2026-09-08#16");
  });

  it("change d'identifiant au changement de jour", () => {
    // C'est ce qui fait repartir l'avis le lendemain : le verrou porte la date.
    assert.notEqual(creneauEchu(le(8, 9), "QUATRE_JOUR"), creneauEchu(le(9, 9), "QUATRE_JOUR"));
  });
});

describe("une fois par semaine", () => {
  it("ne déclenche que le lundi", () => {
    assert.equal(creneauEchu(le(7, 10), "HEBDO"), "2026-09-07#09"); // lundi
    assert.equal(creneauEchu(le(8, 10), "HEBDO"), null); // mardi
    assert.equal(creneauEchu(le(13, 10), "HEBDO"), null); // dimanche
  });

  it("respecte l'heure, même le bon jour", () => {
    assert.equal(creneauEchu(le(7, 8, 59), "HEBDO"), null);
  });
});

describe("les autres rythmes", () => {
  it("toutes les deux heures s'arrête aux heures de bureau", () => {
    // Un avis à 3 h du matin est lu à 9 h de toute façon, et il n'aura fait
    // qu'avoir l'air d'une alerte.
    assert.equal(creneauEchu(le(8, 3), "DEUX_HEURES"), null);
    assert.equal(creneauEchu(le(8, 8), "DEUX_HEURES"), "2026-09-08#08");
    assert.equal(creneauEchu(le(8, 21), "DEUX_HEURES"), "2026-09-08#18");
  });

  it("une fois par jour n'a qu'un créneau", () => {
    assert.equal(creneauEchu(le(8, 9), "UNE_JOUR"), "2026-09-08#09");
    assert.equal(creneauEchu(le(8, 20), "UNE_JOUR"), "2026-09-08#09");
  });
});
