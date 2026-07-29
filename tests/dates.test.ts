import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ajouterJours,
  cleMois,
  debutMois,
  debutSemaine,
  finMois,
  finSemaine,
  fmtMoisCourt,
  isoDate,
  jourDeLaDate,
  jourUtc,
  normaliserHeure,
} from "../src/lib/dates";

/**
 * Les dates de séance sont des jours calendaires manipulés à minuit UTC : c'est
 * la convention qui empêche une séance du lundi de basculer au dimanche selon le
 * fuseau du serveur. Ces tests la verrouillent.
 */

describe("jourUtc", () => {
  it("ramène une chaîne AAAA-MM-JJ à minuit UTC", () => {
    assert.equal(jourUtc("2026-07-29").toISOString(), "2026-07-29T00:00:00.000Z");
  });

  it("efface l'heure sans décaler le jour", () => {
    assert.equal(
      jourUtc(new Date("2026-07-29T22:45:00Z")).toISOString(),
      "2026-07-29T00:00:00.000Z",
    );
  });
});

describe("jourDeLaDate", () => {
  it("nomme le jour de la semaine", () => {
    assert.equal(jourDeLaDate(jourUtc("2026-07-29")), "MERCREDI");
    assert.equal(jourDeLaDate(jourUtc("2026-07-26")), "DIMANCHE");
  });
});

describe("semaines et mois", () => {
  it("la semaine commence le lundi", () => {
    // Le dimanche appartient à la semaine qui l'a précédé, pas à la suivante.
    assert.equal(isoDate(debutSemaine(jourUtc("2026-07-26"))), "2026-07-20");
    assert.equal(isoDate(finSemaine(jourUtc("2026-07-20"))), "2026-07-26");
  });

  it("borne le mois, février bissextile compris", () => {
    assert.equal(isoDate(debutMois(jourUtc("2026-07-29"))), "2026-07-01");
    assert.equal(isoDate(finMois(jourUtc("2026-07-29"))), "2026-07-31");
    assert.equal(isoDate(finMois(jourUtc("2024-02-10"))), "2024-02-29");
  });

  it("passe le cap d'une année", () => {
    assert.equal(isoDate(ajouterJours(jourUtc("2026-12-31"), 1)), "2027-01-01");
    assert.equal(cleMois(jourUtc("2026-12-31")), "2026-12");
  });
});

describe("fmtMoisCourt", () => {
  // Les abréviations françaises sont irrégulières : mars, mai et juin ne
  // s'abrègent pas, avril donne « avr. ». Tronquer à longueur fixe donnait
  // « avri. » et « mars. ».
  it("suit les abréviations françaises", () => {
    assert.equal(fmtMoisCourt("2026-04-01"), "avr.");
    assert.equal(fmtMoisCourt("2026-05-01"), "mai");
    assert.equal(fmtMoisCourt("2026-06-01"), "juin");
    assert.equal(fmtMoisCourt("2026-07-01"), "juil.");
    assert.equal(fmtMoisCourt("2026-12-01"), "déc.");
  });
});

describe("normaliserHeure", () => {
  it("accepte les séparateurs usuels et complète", () => {
    assert.equal(normaliserHeure("9:05"), "09:05");
    assert.equal(normaliserHeure("12h30"), "12:30");
    assert.equal(normaliserHeure(" 12.30 "), "12:30");
  });

  it("refuse une heure impossible", () => {
    assert.equal(normaliserHeure("24:00"), null);
    assert.equal(normaliserHeure("12:60"), null);
    assert.equal(normaliserHeure("midi"), null);
  });
});
