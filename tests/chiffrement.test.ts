import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chiffrer, dechiffrer, estChiffre } from "../src/lib/chiffrement";

describe("chiffrement des secrets de paramétrage", () => {
  it("retrouve la valeur en clair après un aller-retour", () => {
    const c = chiffrer("Mot de passe du compte de service ✓");
    assert.ok(estChiffre(c));
    assert.equal(dechiffrer(c), "Mot de passe du compte de service ✓");
  });

  it("ne produit jamais deux fois la même sortie pour la même entrée", () => {
    assert.notEqual(chiffrer("secret"), chiffrer("secret"));
  });

  it("lit telle quelle une valeur enregistrée avant le chiffrement", () => {
    assert.equal(dechiffrer("ancien-mot-de-passe-en-clair"), "ancien-mot-de-passe-en-clair");
  });

  it("refuse une valeur altérée plutôt que de renvoyer n'importe quoi", () => {
    const c = chiffrer("secret");
    const [p, iv, tag, donnees] = c.split(":");
    const altere = [p, iv, tag, donnees.slice(0, -2) + (donnees.endsWith("AA") ? "BB" : "AA")].join(":");
    assert.equal(dechiffrer(altere), null);
    assert.equal(dechiffrer("enc1:abc"), null);
  });
});
