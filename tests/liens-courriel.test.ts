import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  absenceAutorisee,
  lienAbsence,
  lienPlace,
  placeAutorisee,
  signatureAbsence,
  signaturePlace,
} from "../src/lib/liens-courriel";

/**
 * Signature des liens d'action envoyés par courriel.
 *
 * C'est la seule chose qui autorise ces pages : elles n'ouvrent pas de session,
 * elles sont publiées sur Internet, et elles agissent sur l'inscription de
 * quelqu'un. Une erreur ici ne se verrait pas — tout continuerait de marcher,
 * simplement n'importe qui pourrait déclarer n'importe qui absent.
 *
 * Les cas vérifiés sont ceux qu'une réécriture casserait sans bruit : le lien
 * d'un agent ne doit pas valoir pour un autre, celui d'une séance pas pour la
 * suivante, et les deux usages ne doivent pas partager leurs signatures.
 */

const SEANCE = "cmseance0000000000000000";
const AUTRE_SEANCE = "cmseance1111111111111111";
const AGENT = "cmagent00000000000000000";
const AUTRE_AGENT = "cmagent11111111111111111";

describe("signature d'un lien d'absence", () => {
  it("accepte le couple qu'elle désigne, et lui seul", () => {
    const s = signatureAbsence(SEANCE, AGENT);
    assert.equal(absenceAutorisee(SEANCE, AGENT, s), true);
    assert.equal(absenceAutorisee(SEANCE, AUTRE_AGENT, s), false);
    assert.equal(absenceAutorisee(AUTRE_SEANCE, AGENT, s), false);
  });

  it("refuse une signature absente, vide ou tronquée", () => {
    const s = signatureAbsence(SEANCE, AGENT);
    assert.equal(absenceAutorisee(SEANCE, AGENT, undefined), false);
    assert.equal(absenceAutorisee(SEANCE, AGENT, ""), false);
    assert.equal(absenceAutorisee(SEANCE, AGENT, s.slice(0, -1)), false);
    assert.equal(absenceAutorisee(SEANCE, AGENT, `${s}x`), false);
  });

  it("ne dépend pas de l'ordre des parties", () => {
    // Sans séparateur, « ab » + « c » et « a » + « bc » signeraient pareil : un
    // lien d'absence deviendrait valable pour un autre couple agent/séance.
    assert.notEqual(signatureAbsence("ab", "c"), signatureAbsence("a", "bc"));
  });
});

const PROMUE = { id: "inscription-1", promuAt: new Date("2026-09-01T10:00:00Z") };

describe("signature d'un lien de place", () => {
  it("accepte l'inscription qu'elle désigne, et lui seule", () => {
    const s = signaturePlace(PROMUE);
    assert.equal(placeAutorisee(PROMUE, s), true);
    assert.equal(placeAutorisee({ ...PROMUE, id: "inscription-2" }, s), false);
  });

  it("ne vaut que pour la promotion qui l'a fait envoyer", () => {
    // L'inscription est réutilisée à la réinscription : le lien reçu pour une
    // première promotion ne doit pas rendre la place obtenue à la suivante.
    const s = signaturePlace(PROMUE);
    const repromue = { ...PROMUE, promuAt: new Date("2026-11-03T09:00:00Z") };
    assert.equal(placeAutorisee(repromue, s), false);
  });

  it("refuse une inscription jamais promue, quelle que soit la signature", () => {
    // `promuAt` est remis à zéro à la réinscription : entre deux promotions,
    // aucun lien n'est valable — pas même celui signé sur le vide.
    const jamais = { ...PROMUE, promuAt: null };
    assert.equal(placeAutorisee(jamais, signaturePlace(jamais)), false);
    assert.equal(placeAutorisee(jamais, signaturePlace(PROMUE)), false);
  });

  it("ne se confond pas avec un lien d'absence", () => {
    // Les deux usages partagent le secret : sans préfixe distinct, la signature
    // d'un « je ne viens pas » vaudrait pour un « je rends ma place ».
    const inscription = { id: SEANCE, promuAt: PROMUE.promuAt };
    assert.notEqual(signaturePlace(inscription), signatureAbsence(SEANCE, ""));
    assert.equal(placeAutorisee(inscription, signatureAbsence(SEANCE, "")), false);
  });
});

describe("adresses produites", () => {
  it("colle la signature au bout du chemin et retire la barre finale", () => {
    const url = lienAbsence(SEANCE, AGENT, "https://sport.exemple.fr/");
    assert.equal(
      url,
      `https://sport.exemple.fr/courriel/absence/${SEANCE}/${AGENT}/${signatureAbsence(SEANCE, AGENT)}`,
    );
  });

  it("ne produit rien qu'un client de messagerie coupe", () => {
    // Base64url : ni « + », ni « / », ni « = » — les trois caractères qu'une
    // messagerie échappe, coupe, ou traite comme la fin de l'adresse. Le « / »
    // découperait en outre un segment de chemin de plus, et la route ne
    // reconnaîtrait plus l'adresse.
    assert.match(signaturePlace(PROMUE), /^[A-Za-z0-9_-]{32}$/);
    assert.match(lienPlace(PROMUE, "https://s.fr"), /^https:\/\/s\.fr\/[A-Za-z0-9_/-]+$/);
  });
});
