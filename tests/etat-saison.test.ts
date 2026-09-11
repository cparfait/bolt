import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { etatSaison, saisonTropLongue } from "../src/lib/saison";
import { jourUtc } from "../src/lib/dates";

/**
 * État d'une saison pour le service — ce que le sélecteur, l'écran des
 * saisons et l'avertissement affichent, et ce que `activerSaison` refuse.
 *
 * La comparaison se fait en jours calendaires : une saison reste ouverte
 * jusqu'au soir de son dernier jour, et n'est « en préparation » que tant
 * qu'elle n'a pas commencé.
 */

const SAISON = { active: false, debut: jourUtc("2026-09-01"), fin: jourUtc("2027-06-30") };

describe("etatSaison", () => {
  it("dit « active » dès que le drapeau est posé, quelle que soit la date", () => {
    assert.equal(etatSaison({ ...SAISON, active: true }, jourUtc("2025-01-01")), "active");
    assert.equal(etatSaison({ ...SAISON, active: true }, jourUtc("2030-01-01")), "active");
  });

  it("est en préparation avant son premier jour", () => {
    assert.equal(etatSaison(SAISON, jourUtc("2026-08-31")), "preparation");
  });

  it("est en cours, non affichée, de son premier à son dernier jour", () => {
    assert.equal(etatSaison(SAISON, jourUtc("2026-09-01")), "encours");
    assert.equal(etatSaison(SAISON, jourUtc("2027-01-15")), "encours");
    assert.equal(etatSaison(SAISON, jourUtc("2027-06-30")), "encours");
  });

  it("n'est close que le lendemain de son dernier jour", () => {
    assert.equal(etatSaison(SAISON, jourUtc("2027-07-01")), "close");
  });

  it("compare des jours, pas des instants : le soir du dernier jour, elle tourne encore", () => {
    // `fin` est stockée à minuit UTC ; un instant du même jour lui est
    // postérieur, et la comparaison brute fermait la saison le matin même.
    const soir = new Date("2027-06-30T18:45:00Z");
    assert.equal(etatSaison(SAISON, soir), "encours");
  });
});

describe("saisonTropLongue", () => {
  const debut = jourUtc("2026-09-01");

  it("accepte une saison d'un an et une de deux ans jour pour jour", () => {
    assert.equal(saisonTropLongue(debut, jourUtc("2027-06-30")), false);
    assert.equal(saisonTropLongue(debut, jourUtc("2028-09-01")), false);
  });

  it("refuse au-delà de deux ans — une année de trop dans la date de fin", () => {
    assert.equal(saisonTropLongue(debut, jourUtc("2028-09-02")), true);
    assert.equal(saisonTropLongue(debut, jourUtc("2036-06-30")), true);
  });
});
