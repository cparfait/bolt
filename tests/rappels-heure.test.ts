import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seanceDejaPassee } from "../src/lib/rappels";
import { creneauEchu } from "../src/lib/demandes";
import { heureEntiereCourante, jourSemaineCourant, jourUtc } from "../src/lib/dates";

/**
 * Lot C1 — l'heure de la collectivité dans les tâches de fond.
 *
 * Deux défauts de la même famille : les rappels raisonnaient en jours et
 * rappelaient à midi une séance du matin déjà finie ; l'avis « des demandes
 * attendent » lisait l'heure et le jour de la semaine dans le fuseau du
 * processus, et se décalait sur tout conteneur resté en UTC. Ni l'un ni
 * l'autre ne se voit : un rappel en trop reste un rappel, un avis à 11 h
 * reste un avis.
 */

/** Un instant UTC, écrit tel qu'on le lit dans un journal. */
const t = (iso: string) => new Date(iso);

describe("séance du jour déjà terminée", () => {
  const creneau = { heureDebut: "09:00", heureFin: "10:00" };
  // Été : 12 h à Paris = 10 h UTC.
  const midi = t("2026-07-08T10:00:00Z");

  it("écarte la séance du jour dont l'heure de fin est passée", () => {
    assert.equal(seanceDejaPassee({ date: jourUtc("2026-07-08"), creneau }, midi), true);
  });

  it("garde la séance du jour encore à venir, ou en cours", () => {
    const soir = { heureDebut: "18:00", heureFin: "19:00" };
    assert.equal(seanceDejaPassee({ date: jourUtc("2026-07-08"), creneau: soir }, midi), false);
    const enCours = { heureDebut: "11:30", heureFin: "12:30" };
    assert.equal(seanceDejaPassee({ date: jourUtc("2026-07-08"), creneau: enCours }, midi), false);
  });

  it("ne juge que le jour courant : demain n'est jamais passé", () => {
    assert.equal(seanceDejaPassee({ date: jourUtc("2026-07-09"), creneau }, midi), false);
  });

  it("compare dans le fuseau de la collectivité", () => {
    // 23 h 30 UTC le 8 = 1 h 30 le 9 à Paris : la séance du 9 à 1 h est passée,
    // alors que la date UTC dit encore « hier ».
    const nuit = t("2026-07-08T23:30:00Z");
    const tot = { heureDebut: "00:30", heureFin: "01:00" };
    assert.equal(seanceDejaPassee({ date: jourUtc("2026-07-09"), creneau: tot }, nuit), true);
  });

  it("se rabat sur l'heure de début quand la fin est illisible", () => {
    const sansFin = { heureDebut: "09:00", heureFin: "" };
    assert.equal(seanceDejaPassee({ date: jourUtc("2026-07-08"), creneau: sansFin }, midi), true);
  });
});

describe("heure et jour de la collectivité", () => {
  it("lit l'heure entière à Paris, été comme hiver", () => {
    assert.equal(heureEntiereCourante(t("2026-07-08T07:15:00Z")), 9); // été : UTC+2
    assert.equal(heureEntiereCourante(t("2026-01-15T07:15:00Z")), 8); // hiver : UTC+1
  });

  it("bascule de jour au minuit de Paris", () => {
    // Le 12 juillet 2026 est un dimanche ; à 23 h UTC on est déjà lundi à Paris.
    assert.equal(jourSemaineCourant(t("2026-07-12T20:00:00Z")), 0);
    assert.equal(jourSemaineCourant(t("2026-07-12T23:00:00Z")), 1);
  });
});

describe("créneau d'avis, à l'heure de Paris", () => {
  it("compte les créneaux en heure locale et non en UTC", () => {
    // 7 h 30 UTC en été = 9 h 30 à Paris : le créneau de 9 h est échu.
    assert.equal(creneauEchu(t("2026-07-08T07:30:00Z"), "UNE_JOUR"), "2026-07-08#09");
    // 7 h 30 UTC en hiver = 8 h 30 à Paris : pas encore.
    assert.equal(creneauEchu(t("2026-01-14T07:30:00Z"), "UNE_JOUR"), null);
  });

  it("date le créneau du jour parisien", () => {
    // 22 h 30 UTC le 7 = 0 h 30 le 8 à Paris : aucun créneau du 8 n'est encore passé.
    assert.equal(creneauEchu(t("2026-07-07T22:30:00Z"), "UNE_JOUR"), null);
    assert.equal(creneauEchu(t("2026-07-07T20:30:00Z"), "UNE_JOUR"), "2026-07-07#09");
  });

  it("reconnaît le lundi de Paris pour l'avis hebdomadaire", () => {
    // Dimanche 12 juillet 23 h UTC = lundi 13, 1 h : lundi, mais avant 9 h.
    assert.equal(creneauEchu(t("2026-07-12T23:00:00Z"), "HEBDO"), null);
    assert.equal(creneauEchu(t("2026-07-13T07:00:00Z"), "HEBDO"), "2026-07-13#09");
    assert.equal(creneauEchu(t("2026-07-14T07:00:00Z"), "HEBDO"), null); // mardi
  });
});
