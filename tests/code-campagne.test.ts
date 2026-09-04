import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_GENERAL, codeDemandeValide, lienDemandeAcces } from "../src/lib/settings";

/**
 * Code de campagne du formulaire de demande d'accès.
 *
 * Il ne protège pas grand-chose — il voyage dans une URL affichée sur un mur —
 * mais il décide si la page existe. S'inverser ici publierait le formulaire à
 * qui balaie le domaine, sans qu'aucun écran ne change d'apparence.
 */

const cfg = (partiel: Partial<typeof DEFAULT_GENERAL>) => ({
  ...DEFAULT_GENERAL,
  ...partiel,
});

describe("aucun code configuré", () => {
  it("laisse le formulaire ouvert", () => {
    // Le réglage est facultatif : son absence ne doit pas fermer un formulaire
    // que la collectivité a délibérément activé.
    const g = cfg({ demandeAccesCode: "" });
    assert.equal(codeDemandeValide(g, undefined), true);
    assert.equal(codeDemandeValide(g, "n'importe quoi"), true);
  });

  it("produit un lien sans paramètre", () => {
    const g = cfg({ demandeAccesCode: "", appUrl: "https://exemple.fr" });
    assert.equal(lienDemandeAcces(g), "https://exemple.fr/demande-acces");
  });
});

describe("code configuré", () => {
  const g = cfg({ demandeAccesCode: "rentree2026", appUrl: "https://exemple.fr" });

  it("accepte le bon code", () => {
    assert.equal(codeDemandeValide(g, "rentree2026"), true);
  });

  it("tolère les espaces autour, qu'un copier-coller ajoute", () => {
    assert.equal(codeDemandeValide(g, "  rentree2026 "), true);
  });

  it("refuse l'absence de code — le cas du robot qui balaie", () => {
    assert.equal(codeDemandeValide(g, undefined), false);
    assert.equal(codeDemandeValide(g, ""), false);
    assert.equal(codeDemandeValide(g, null), false);
  });

  it("refuse un code approchant", () => {
    assert.equal(codeDemandeValide(g, "rentree2025"), false);
    assert.equal(codeDemandeValide(g, "RENTREE2026"), false);
    assert.equal(codeDemandeValide(g, "rentree2026x"), false);
  });

  it("porte le code dans le lien à distribuer", () => {
    assert.equal(
      lienDemandeAcces(g),
      "https://exemple.fr/demande-acces?i=rentree2026",
    );
  });
});
