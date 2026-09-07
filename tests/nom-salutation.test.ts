import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composerNomAffiche, nomPourSalutation } from "../src/lib/constants";

/**
 * Nom en tête de courriel.
 *
 * L'annuaire rend « PARFAIT Christophe » — patronyme en capitales d'abord,
 * convention d'affichage d'un AD. Écrit tel quel, le courriel commence par
 * « Bonjour PARFAIT Christophe » ; en prenant le premier mot, il commence par
 * le nom de famille. Ni l'un ni l'autre ne se dit à quelqu'un.
 */

describe("nom venu de l'annuaire", () => {
  it("remet le prénom devant et adoucit les capitales", () => {
    assert.equal(nomPourSalutation("PARFAIT Christophe"), "Christophe Parfait");
  });

  it("garde les prénoms composés et les patronymes en deux mots", () => {
    assert.equal(nomPourSalutation("LE GOFF Marie-Anne"), "Marie-Anne Le Goff");
    assert.equal(nomPourSalutation("VAN DER BERG Jean Pierre"), "Jean Pierre Van Der Berg");
  });

  it("capitalise après une apostrophe ou un trait d'union", () => {
    assert.equal(nomPourSalutation("D'ARGENT Paul"), "Paul D'Argent");
  });
});

describe("nom saisi à la main", () => {
  it("ne devine pas l'ordre quand rien ne le distingue", () => {
    // « Chloé Parfait » et « Parfait Chloé » sont indiscernables : inverser au
    // hasard se tromperait une fois sur deux. Le formulaire demande donc le
    // prénom en premier, et on respecte ce qui a été saisi.
    assert.equal(nomPourSalutation("Chloé Parfait"), "Chloé Parfait");
    assert.equal(nomPourSalutation("Parfait Chloé"), "Parfait Chloé");
  });

  it("laisse tranquille un nom d'un seul mot", () => {
    assert.equal(nomPourSalutation("Madonna"), "Madonna");
    assert.equal(nomPourSalutation("  "), "");
  });

  it("tout en capitales : rien à réordonner", () => {
    assert.equal(nomPourSalutation("PARFAIT CHRISTOPHE"), "PARFAIT CHRISTOPHE");
  });
});

/**
 * Deux cases à la saisie, un seul nom affiché.
 *
 * La composition suit la convention de l'annuaire — patronyme en capitales
 * d'abord — pour que les comptes créés à la main et ceux venus de l'AD se
 * trient ensemble, et pour que `nomPourSalutation` retrouve l'ordre juste.
 */
describe("nom composé de deux cases", () => {
  it("écrit le patronyme en capitales, devant le prénom", () => {
    assert.equal(composerNomAffiche("Camille", "Dupont"), "DUPONT Camille");
  });

  it("se relit correctement en tête d'un courriel", () => {
    assert.equal(nomPourSalutation(composerNomAffiche("Camille", "Dupont")), "Camille Dupont");
  });

  it("ne se fie pas à la casse saisie", () => {
    assert.equal(composerNomAffiche("CAMILLE", "dupont"), "DUPONT Camille");
  });

  it("respecte les prénoms composés et les particules", () => {
    assert.equal(composerNomAffiche("marie-anne", "le goff"), "LE GOFF Marie-Anne");
  });

  it("resserre les espaces surnuméraires", () => {
    assert.equal(composerNomAffiche("  Camille  ", " Dupont "), "DUPONT Camille");
  });

  it("ne laisse pas d'espace quand une case est vide", () => {
    assert.equal(composerNomAffiche("", "Dupont"), "DUPONT");
    assert.equal(composerNomAffiche("Camille", ""), "Camille");
  });
});
