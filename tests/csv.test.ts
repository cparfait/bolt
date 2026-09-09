import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { celluleCsv } from "../src/lib/stats";

describe("cellules de l'export CSV", () => {
  it("laisse passer une valeur ordinaire", () => {
    assert.equal(celluleCsv("Yoga"), "Yoga");
    assert.equal(celluleCsv(12), "12");
  });

  it("neutralise ce qu'Excel lirait comme une formule", () => {
    assert.equal(celluleCsv("=1+1"), "'=1+1");
    assert.equal(celluleCsv("+33 6"), "'+33 6");
    assert.equal(celluleCsv("-x"), "'-x");
    assert.equal(celluleCsv("@SUM"), "'@SUM");
  });

  it("protège séparateurs, guillemets et retours à la ligne", () => {
    assert.equal(celluleCsv("Gymnase ; salle 2"), '"Gymnase ; salle 2"');
    assert.equal(celluleCsv('Dit "bonjour"'), '"Dit ""bonjour"""');
    assert.equal(celluleCsv("a\nb"), '"a\nb"');
  });
});

describe("politique de sécurité du contenu", () => {
  it("porte le nonce et refuse l'inline sans lui", async () => {
    const { politiqueCsp, nonceAleatoire } = await import("../src/lib/csp");
    const nonce = nonceAleatoire();
    const csp = politiqueCsp(nonce, false);
    assert.match(csp, new RegExp(`script-src 'self' 'nonce-${nonce.replace(/[+/=]/g, "\$&")}' 'strict-dynamic'`));
    assert.doesNotMatch(csp, /unsafe-inline'[^;]*;[^;]*script|script-src[^;]*unsafe-inline/);
    assert.doesNotMatch(csp, /unsafe-eval/);
    assert.match(politiqueCsp(nonce, true), /unsafe-eval/);
    assert.notEqual(nonceAleatoire(), nonceAleatoire());
  });
});
