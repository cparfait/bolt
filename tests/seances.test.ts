import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Fermeture } from "@prisma/client";
import { datesDuCreneau } from "../src/lib/seances";
import { isoDate, jourUtc } from "../src/lib/dates";

/**
 * Génération du calendrier — la fonction dont dépend tout le reste : sans les
 * bonnes dates, ni émargement ni statistiques n'ont de sens.
 */

const SAISON = { debut: jourUtc("2026-09-01"), fin: jourUtc("2026-10-31") };

/** Fermeture minimale : seules les bornes comptent pour la génération. */
function fermeture(debut: string, fin: string): Fermeture {
  return {
    id: `f-${debut}`,
    saisonId: "s",
    libelle: `${debut} → ${fin}`,
    debut: jourUtc(debut),
    fin: jourUtc(fin),
  };
}

const dates = (...args: Parameters<typeof datesDuCreneau>) =>
  datesDuCreneau(...args).map(isoDate);

describe("datesDuCreneau", () => {
  it("se cale sur la première occurrence du jour demandé", () => {
    // 2026-09-01 est un mardi : le premier lundi de la saison est le 7.
    const d = dates({ jour: "LUNDI", dateDebut: null, dateFin: null }, SAISON, []);
    assert.equal(d[0], "2026-09-07");
    assert.deepEqual(d, [
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
    ]);
  });

  it("retient le premier jour de la saison quand il tombe juste", () => {
    const d = dates({ jour: "MARDI", dateDebut: null, dateFin: null }, SAISON, []);
    assert.equal(d[0], "2026-09-01");
  });

  it("ne dépasse jamais la fin de la saison", () => {
    const d = dates({ jour: "SAMEDI", dateDebut: null, dateFin: null }, SAISON, []);
    assert.equal(d.at(-1), "2026-10-31"); // la fin est incluse
  });

  it("exclut les périodes de fermeture, bornes comprises", () => {
    const d = dates({ jour: "LUNDI", dateDebut: null, dateFin: null }, SAISON, [
      fermeture("2026-09-14", "2026-09-21"), // couvre deux lundis, aux deux bornes
    ]);
    assert.ok(!d.includes("2026-09-14"));
    assert.ok(!d.includes("2026-09-21"));
    assert.ok(d.includes("2026-09-07"));
    assert.ok(d.includes("2026-09-28"));
  });

  it("respecte les bornes propres au créneau", () => {
    const d = dates(
      { jour: "LUNDI", dateDebut: jourUtc("2026-09-15"), dateFin: jourUtc("2026-10-06") },
      SAISON,
      [],
    );
    assert.deepEqual(d, ["2026-09-21", "2026-09-28", "2026-10-05"]);
  });

  it("ne génère rien si les bornes sont inversées", () => {
    const d = dates(
      { jour: "LUNDI", dateDebut: jourUtc("2026-10-06"), dateFin: jourUtc("2026-09-15") },
      SAISON,
      [],
    );
    assert.deepEqual(d, []);
  });

  it("ne génère rien si la saison entière est fermée", () => {
    const d = dates({ jour: "LUNDI", dateDebut: null, dateFin: null }, SAISON, [
      fermeture("2026-09-01", "2026-10-31"),
    ]);
    assert.deepEqual(d, []);
  });

  it("traverse un changement d'année sans dériver de jour", () => {
    const d = dates(
      { jour: "JEUDI", dateDebut: null, dateFin: null },
      { debut: jourUtc("2026-12-24"), fin: jourUtc("2027-01-14") },
      [],
    );
    assert.deepEqual(d, ["2026-12-24", "2026-12-31", "2027-01-07", "2027-01-14"]);
  });
});
