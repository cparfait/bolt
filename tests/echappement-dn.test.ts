import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { echapperDn } from "../src/lib/ldap";

/**
 * Échappement d'un identifiant inséré dans un gabarit de DN (RFC 4514).
 *
 * Le gabarit « CN={username},OU=Agents,DC=x » reçoit ce qui a été tapé à
 * l'écran de connexion. Une virgule y ouvre un nouveau composant, un « = » y
 * change l'attribut : l'identifiant ne désigne plus la personne qu'on croit.
 */

describe("echapperDn", () => {
  it("laisse un identifiant ordinaire intact", () => {
    assert.equal(echapperDn("c.parfait"), "c.parfait");
    assert.equal(echapperDn("jean-pierre_02"), "jean-pierre_02");
  });

  it("neutralise les séparateurs de composants et d'attributs", () => {
    assert.equal(echapperDn("x,OU=Admins"), "x\\,OU\\=Admins");
    assert.equal(echapperDn("a+b;c"), "a\\+b\\;c");
  });

  it("neutralise les guillemets, chevrons et antislashs", () => {
    assert.equal(echapperDn('a"b<c>d\\e'), 'a\\"b\\<c\\>d\\\\e');
  });

  it("ne protège les espaces et le dièse qu'aux extrémités", () => {
    assert.equal(echapperDn(" a b "), "\\ a b\\ ");
    assert.equal(echapperDn("#a#"), "\\#a#");
  });

  it("remplace un octet nul par sa forme hexadécimale", () => {
    assert.equal(echapperDn("a\0b"), "a\\00b");
  });

  it("insère un identifiant hostile sans changer la branche du gabarit", () => {
    const dn = "CN={username},OU=Agents,DC=x".replace(/\{username\}/g, echapperDn("x,OU=Admins,DC=x"));
    assert.equal(dn, "CN=x\\,OU\\=Admins\\,DC\\=x,OU=Agents,DC=x");
  });
});
