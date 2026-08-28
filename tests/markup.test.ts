import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { amorceDe, analyserInline, analyserMarkup, texteBrut } from "../src/lib/markup";

/**
 * Langage de mise en forme des textes légaux.
 *
 * Deux exigences se croisent ici : le service des sports doit pouvoir mettre en
 * gras une clause de responsabilité, et rien de ce qu'il saisit ne doit pouvoir
 * devenir du code exécuté chez l'agent. D'où une syntaxe fermée, dont ces tests
 * vérifient qu'elle ne laisse rien passer d'autre.
 */

describe("analyserInline", () => {
  it("laisse un texte sans marque en un seul segment", () => {
    assert.deepEqual(analyserInline("Je certifie que"), [{ texte: "Je certifie que" }]);
  });

  it("reconnaît le gras et le souligné", () => {
    assert.deepEqual(analyserInline("**Je certifie** que __tout__ va"), [
      { texte: "Je certifie", gras: true },
      { texte: " que " },
      { texte: "tout", souligne: true },
      { texte: " va" },
    ]);
  });

  it("combine les deux quand elles s'imbriquent", () => {
    assert.deepEqual(analyserInline("**__grave__**"), [
      { texte: "grave", gras: true, souligne: true },
    ]);
  });

  it("garde une marque jamais refermée telle quelle", () => {
    // Sinon la fin du texte disparaîtrait sur une simple faute de frappe.
    assert.deepEqual(analyserInline("**oubli"), [{ texte: "**oubli" }]);
    assert.deepEqual(analyserInline("2 ** 3 = 8"), [{ texte: "2 ** 3 = 8" }]);
  });

  it("recolle deux segments de même style", () => {
    assert.deepEqual(analyserInline("**a****b**"), [{ texte: "ab", gras: true }]);
  });
});

describe("analyserMarkup", () => {
  it("sépare les paragraphes sur une ligne vide", () => {
    const blocs = analyserMarkup("premier\n\nsecond");
    assert.deepEqual(
      blocs.map((b) => b.type),
      ["paragraphe", "paragraphe"],
    );
  });

  it("recolle les lignes d'un même paragraphe", () => {
    const blocs = analyserMarkup("une phrase\ncoupée en deux");
    assert.equal(blocs.length, 1);
    assert.deepEqual(blocs[0], {
      type: "paragraphe",
      segments: [{ texte: "une phrase coupée en deux" }],
    });
  });

  it("groupe les puces consécutives en une seule liste", () => {
    const blocs = analyserMarkup("- un\n- deux\n- trois");
    assert.equal(blocs.length, 1);
    assert.equal(blocs[0].type, "liste");
    assert.equal(blocs[0].type === "liste" && blocs[0].items.length, 3);
  });

  it("laisse un paragraphe reprendre après une liste", () => {
    const blocs = analyserMarkup("avant\n- puce\naprès");
    assert.deepEqual(
      blocs.map((b) => b.type),
      ["paragraphe", "liste", "paragraphe"],
    );
  });

  it("ne rend rien d'un texte vide", () => {
    assert.deepEqual(analyserMarkup(""), []);
    assert.deepEqual(analyserMarkup("   \n\n  "), []);
  });

  it("traite le HTML comme du texte, jamais comme des balises", () => {
    // La garantie centrale : la sortie est une donnée, pas du balisage. Le
    // rendu construit des éléments React à partir de ces segments.
    const blocs = analyserMarkup("<script>alert(1)</script>");
    assert.deepEqual(blocs, [
      { type: "paragraphe", segments: [{ texte: "<script>alert(1)</script>" }] },
    ]);
  });
});

describe("texteBrut", () => {
  it("retire les marques", () => {
    assert.equal(texteBrut("**Je certifie** que __oui__"), "Je certifie que oui");
  });

  it("aplatit listes et paragraphes", () => {
    assert.equal(texteBrut("intro\n\n- un\n- deux"), "intro un deux");
  });
});

describe("amorceDe", () => {
  it("prend l'amorce en gras quand il y en a une", () => {
    assert.equal(amorceDe("**Je m'engage** à arrêter l'activité"), "Je m'engage");
  });

  it("retombe sur les premiers mots, coupés sur un espace", () => {
    assert.equal(
      amorceDe("Je prends acte que cette activité se déroule hors du temps de travail", 20),
      "Je prends acte que…",
    );
  });

  it("rend le texte entier s'il est déjà court", () => {
    assert.equal(amorceDe("Je certifie", 40), "Je certifie");
  });

  it("ne casse pas sur un texte vide", () => {
    assert.equal(amorceDe(""), "");
  });
});
