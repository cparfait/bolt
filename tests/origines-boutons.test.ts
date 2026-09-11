import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apercu, originesAutorisees, sansNotation } from "../src/lib/mail";
import { DEFAULT_GENERAL, type GeneralSettings } from "../src/lib/settings";

/**
 * Où un bouton de courriel a le droit de mener.
 *
 * La notation « [libellé](https://…) » s'applique à tout le corps, y compris
 * aux champs libres — motif d'annulation d'un animateur, nom déposé sur le
 * formulaire de demande d'accès. Un bouton vers un site étranger, dans un
 * courriel signé de la collectivité, est la forme exacte d'un hameçonnage.
 * On vérifie donc que la notation ne vaut que vers les origines de
 * l'application, et que le reste redevient du texte.
 */

const APP = "https://bolt.chatillon92.fr";
const ORIGINES = [APP, "https://www.google.com"];

describe("originesAutorisees", () => {
  const g = (partiel: Partial<GeneralSettings>): GeneralSettings => ({
    ...DEFAULT_GENERAL,
    ...partiel,
  });

  it("retient l'origine de chaque adresse configurée, sans le chemin", () => {
    const o = originesAutorisees(g({ appUrl: `${APP}/`, pointageUrl: "https://sport.ville.fr/x" }));
    assert.ok(o.includes(APP));
    assert.ok(o.includes("https://sport.ville.fr"));
  });

  it("y ajoute celle des itinéraires", () => {
    // Les rappels de séance portent un lien « itinéraire » vers Google Maps :
    // sans cette origine, chaque rappel perdrait son lien.
    assert.ok(originesAutorisees(g({})).includes("https://www.google.com"));
  });

  it("ignore une adresse vide ou illisible", () => {
    const o = originesAutorisees(g({ appUrl: "", pointageUrl: "pas une adresse" }));
    assert.equal(o.some((x) => x.includes("pas une")), false);
  });
});

describe("notation bornée aux origines connues", () => {
  it("transforme un lien vers l'application", () => {
    assert.equal(
      sansNotation(`[Me connecter](${APP}/acces)`, ORIGINES),
      `Me connecter : ${APP}/acces`,
    );
  });

  it("laisse en toutes lettres un lien vers un site étranger", () => {
    // C'est le texte d'un animateur ou d'un inconnu : il reste ce qu'il est,
    // et l'adresse se lit telle quelle.
    const piege = "[Me connecter](https://bolt-chatillon92.fr/acces)";
    assert.equal(sansNotation(piege, ORIGINES), piege);
  });

  it("compare l'origine entière, pas un préfixe", () => {
    // « https://bolt.chatillon92.fr.evil.io » commence comme l'origine de
    // l'application ; un test par préfixe le laisserait passer.
    const piege = `[Me connecter](${APP}.evil.io/acces)`;
    assert.equal(sansNotation(piege, ORIGINES), piege);
    assert.equal(sansNotation("[x](http://bolt.chatillon92.fr/acces)", ORIGINES), "[x](http://bolt.chatillon92.fr/acces)");
  });

  it("trie action par action dans un même corps", () => {
    assert.equal(
      sansNotation(`[A](${APP}/a) et [B](https://b.fr)`, ORIGINES),
      `A : ${APP}/a et [B](https://b.fr)`,
    );
  });

  it("sans liste, ne restreint rien — c'est le régime de l'aperçu", () => {
    assert.equal(sansNotation("[A](https://b.fr)"), "A : https://b.fr");
  });

  it("l'aperçu suit la même règle", () => {
    assert.equal(
      apercu("Bonjour,\n\n[Me connecter](https://b.fr/x)", ORIGINES),
      "[Me connecter](https://b.fr/x)",
    );
  });
});
