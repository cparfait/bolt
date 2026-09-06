import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { regrouperEcarts } from "../src/lib/rapprochement";

/**
 * Rapprochement des rattachements avec le référentiel des services.
 *
 * Deux règles portent tout l'écran, et aucune ne se voit à la relecture : un
 * libellé déjà au référentiel n'est pas un écart, quelle que soit sa casse ; et
 * un compte d'annuaire se compte à part, parce qu'il ne se corrige pas dans
 * Bolt — la synchronisation le réécrirait.
 */

const ad = (service: string | null) => ({ login: "cparfait", service });
const horsAd = (service: string | null) => ({ login: "no_ad.camille.martin", service });

describe("écarts de rattachement", () => {
  it("ignore ce qui figure déjà au référentiel, casse comprise", () => {
    const ecarts = regrouperEcarts(
      [horsAd("DSI"), horsAd("dsi"), horsAd("  DSI  ")],
      ["DSI"],
    );
    assert.deepEqual(ecarts, []);
  });

  it("ignore les comptes sans service", () => {
    assert.deepEqual(regrouperEcarts([horsAd(null), horsAd("   ")], ["DSI"]), []);
  });

  it("sépare ce qui est corrigeable de ce qui ne l'est pas", () => {
    const [ecart] = regrouperEcarts(
      [horsAd("Service info"), ad("Service info"), ad("Service info")],
      ["DSI"],
    );
    assert.equal(ecart.libelle, "Service info");
    assert.equal(ecart.horsAnnuaire, 1);
    assert.equal(ecart.annuaire, 2);
  });

  it("regroupe les orthographes d'un même libellé absent du référentiel", () => {
    const ecarts = regrouperEcarts(
      [horsAd("Petite enfance"), horsAd("petite enfance")],
      ["DSI"],
    );
    assert.equal(ecarts.length, 1);
    assert.equal(ecarts[0].horsAnnuaire, 2);
    // Le premier rencontré donne son orthographe : c'est celle qu'on affiche,
    // et elle n'a pas à être arbitrée — la ligne sera rattachée, pas conservée.
    assert.equal(ecarts[0].libelle, "Petite enfance");
  });

  it("classe les plus nombreux d'abord", () => {
    const ecarts = regrouperEcarts(
      [horsAd("Rare"), horsAd("Fréquent"), horsAd("Fréquent"), horsAd("Fréquent")],
      [],
    );
    assert.deepEqual(
      ecarts.map((e) => e.libelle),
      ["Fréquent", "Rare"],
    );
  });

  it("départage les libellés à égalité par l'ordre alphabétique", () => {
    const ecarts = regrouperEcarts([horsAd("Voirie"), horsAd("Écoles")], []);
    assert.deepEqual(
      ecarts.map((e) => e.libelle),
      ["Écoles", "Voirie"],
    );
  });
});
