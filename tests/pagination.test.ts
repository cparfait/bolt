import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tranche } from "../src/components/pagination";

/**
 * Découpage d'une liste en pages.
 *
 * Le numéro vient de l'adresse, donc de l'extérieur : il peut être absent,
 * négatif, décimal, alphabétique, ou désigner une page qui n'existe plus depuis
 * qu'un filtre a réduit la liste. Aucun de ces cas ne doit produire une page
 * vide sans explication — ni un `skip` négatif, que Prisma refuse.
 */

describe("tranche d'une liste", () => {
  it("découpe une liste ordinaire", () => {
    assert.deepEqual(tranche("2", 120, 50), { page: 2, pages: 3, skip: 50, take: 50 });
    assert.deepEqual(tranche(undefined, 120, 50), { page: 1, pages: 3, skip: 0, take: 50 });
  });

  it("ramène à la première page ce qui n'est pas un numéro", () => {
    for (const brut of ["", "0", "-3", "abc", "1.9", "NaN"]) {
      assert.equal(tranche(brut, 120, 50).page, 1, JSON.stringify(brut));
      assert.equal(tranche(brut, 120, 50).skip, 0);
    }
  });

  it("retombe sur la dernière page existante plutôt que sur du vide", () => {
    // Cas réel : on est page 7, on pose un filtre, il ne reste que 12 lignes.
    const t = tranche("7", 12, 50);
    assert.deepEqual(t, { page: 1, pages: 1, skip: 0, take: 50 });
  });

  it("compte une page même sur une liste vide", () => {
    // Zéro page ferait afficher « page 1 sur 0 », et diviserait la confiance
    // qu'on accorde au reste de l'écran.
    assert.deepEqual(tranche(undefined, 0, 50), { page: 1, pages: 1, skip: 0, take: 50 });
  });

  it("ne coupe pas une liste qui tient sur une page", () => {
    assert.equal(tranche(undefined, 50, 50).pages, 1);
    assert.equal(tranche(undefined, 51, 50).pages, 2);
  });
});
