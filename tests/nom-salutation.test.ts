import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nomPourSalutation } from "../src/lib/constants";

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
