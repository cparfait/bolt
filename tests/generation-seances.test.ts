import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { datesDuCreneau, decrirePertesGeneration } from "../src/lib/seances";
import { isoDate, jourUtc } from "../src/lib/dates";

/**
 * Garde-fou de la génération : `enregistrerSaison` admet jusqu'à deux ans,
 * la boucle doit donc couvrir 104 semaines sans couper — la garde à 100
 * tronquait en silence la fin d'une saison pourtant acceptée.
 */
describe("datesDuCreneau — saison longue", () => {
  it("couvre une saison de deux ans sans perdre la fin", () => {
    const saison = { debut: jourUtc("2026-09-01"), fin: jourUtc("2028-08-31") };
    const d = datesDuCreneau({ jour: "MARDI", dateDebut: null, dateFin: null }, saison, []);
    // 2026-09-01 est un mardi ; 2028-08-29 est le dernier mardi avant la fin.
    assert.equal(isoDate(d[0]), "2026-09-01");
    assert.equal(isoDate(d.at(-1)!), "2028-08-29");
    assert.equal(d.length, 105);
  });

  it("s'arrête quand même sur une saison aberrante", () => {
    const saison = { debut: jourUtc("2026-09-01"), fin: jourUtc("2046-09-01") };
    const d = datesDuCreneau({ jour: "MARDI", dateDebut: null, dateFin: null }, saison, []);
    assert.equal(d.length, 160);
  });
});

/**
 * Compte rendu de ce qu'une régénération emporte avec les séances retirées.
 */
describe("decrirePertesGeneration", () => {
  const base = { creees: 0, existantes: 0, supprimees: 0 };

  it("ne dit rien quand rien n'est perdu", () => {
    assert.equal(
      decrirePertesGeneration({ ...base, absencesRetirees: 0, participationsRetirees: 0 }),
      "",
    );
  });

  it("nomme les participations ponctuelles retirées", () => {
    assert.equal(
      decrirePertesGeneration({ ...base, absencesRetirees: 0, participationsRetirees: 1 }),
      " 1 participation ponctuelle retirée avec les séances.",
    );
    assert.equal(
      decrirePertesGeneration({ ...base, absencesRetirees: 0, participationsRetirees: 3 }),
      " 3 participations ponctuelles retirées avec les séances.",
    );
  });

  it("cumule absences annoncées et participations", () => {
    assert.equal(
      decrirePertesGeneration({ ...base, absencesRetirees: 2, participationsRetirees: 1 }),
      " 1 participation ponctuelle et 2 absences annoncées retirées avec les séances.",
    );
  });
});
