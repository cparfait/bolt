import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signatureCourriel, tournures } from "../src/lib/settings";

/**
 * Le nom de l'équipe est un réglage écrit en tête de phrase ; les écrans le
 * citent aussi après « à » et « de », où le français contracte l'article. Une
 * erreur ici s'imprime dans chaque courriel : « demandez à le service ».
 */

describe("tournures — le nom de l'équipe aux positions d'une phrase", () => {
  it("garde l'article élidé de « L'équipe … »", () => {
    const e = tournures({ signatureMail: "L'équipe Qualité de Vie au Travail" });
    assert.equal(e.enTete, "L'équipe Qualité de Vie au Travail");
    assert.equal(e.equipe, "l'équipe Qualité de Vie au Travail");
    assert.equal(e.a, "à l'équipe Qualité de Vie au Travail");
    assert.equal(e.de, "de l'équipe Qualité de Vie au Travail");
  });

  it("contracte « le » en « au » et « du »", () => {
    const e = tournures({ signatureMail: "Le service des sports" });
    assert.equal(e.equipe, "le service des sports");
    assert.equal(e.a, "au service des sports");
    assert.equal(e.de, "du service des sports");
  });

  it("contracte « les » en « aux » et « des »", () => {
    const e = tournures({ signatureMail: "Les animateurs sportifs" });
    assert.equal(e.a, "aux animateurs sportifs");
    assert.equal(e.de, "des animateurs sportifs");
  });

  it("élide « de » devant une voyelle sans article", () => {
    const e = tournures({ signatureMail: "Équipe QVT" });
    assert.equal(e.enTete, "Équipe QVT");
    assert.equal(e.a, "à équipe QVT");
    assert.equal(e.de, "d'équipe QVT");
  });

  it("retombe sur la valeur par défaut quand le réglage est vide", () => {
    assert.equal(tournures({ signatureMail: "  " }).enTete, "L'équipe Qualité de Vie au Travail");
  });
});

describe("signatureCourriel", () => {
  it("ajoute l'adresse de contact quand elle existe", () => {
    assert.equal(
      signatureCourriel({ signatureMail: "L'équipe QVT", contactEmail: "qvt@exemple.fr" }),
      "L'équipe QVT — qvt@exemple.fr",
    );
    assert.equal(signatureCourriel({ signatureMail: "L'équipe QVT", contactEmail: "" }), "L'équipe QVT");
  });
});
