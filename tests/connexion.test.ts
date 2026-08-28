import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estUneAdresse, loginDepuisAdresse } from "../src/lib/auth";

/**
 * Connexion par identifiant Windows ou par adresse.
 *
 * Le point sensible est unique : cette fonction décide sur QUEL compte un mot
 * de passe va être vérifié. Se tromper de compte, c'est connecter quelqu'un
 * chez un autre. D'où le refus systématique en cas d'ambiguïté, plutôt qu'un
 * choix par défaut.
 */

const compte = (login: string, email: string | null, emailContact: string | null = null) => ({
  login,
  email,
  emailContact,
});

describe("estUneAdresse", () => {
  it("distingue une adresse d'un identifiant", () => {
    assert.equal(estUneAdresse("j.dupont@chatillon92.fr"), true);
    assert.equal(estUneAdresse("jdupont"), false);
  });
});

describe("loginDepuisAdresse", () => {
  const annuaire = [
    compte("jdupont", "j.dupont@chatillon92.fr"),
    compte("mmartin", "m.martin@chatillon92.fr", "martin.perso@example.com"),
  ];

  it("retrouve le compte par son adresse d'annuaire", () => {
    assert.equal(loginDepuisAdresse(annuaire, "j.dupont@chatillon92.fr"), "jdupont");
  });

  it("accepte aussi l'adresse de contact saisie par le service des sports", () => {
    // C'est souvent la seule que l'agent de terrain connaît et consulte.
    assert.equal(loginDepuisAdresse(annuaire, "martin.perso@example.com"), "mmartin");
  });

  it("ignore la casse et les espaces autour", () => {
    assert.equal(loginDepuisAdresse(annuaire, "  J.Dupont@Chatillon92.FR "), "jdupont");
  });

  it("normalise l'identifiant renvoyé en minuscules", () => {
    assert.equal(loginDepuisAdresse([compte("JDupont", "j@x.fr")], "j@x.fr"), "jdupont");
  });

  it("ne renvoie rien sur une adresse inconnue", () => {
    // L'appelant repart alors sur la saisie brute : l'authentification échoue
    // avec son message habituel, sans révéler que l'adresse est inconnue.
    assert.equal(loginDepuisAdresse(annuaire, "personne@ailleurs.fr"), null);
  });

  it("fait primer l'adresse d'annuaire sur l'adresse de contact", () => {
    // Une adresse de contact est saisie à la main : elle ne doit pas pouvoir
    // détourner une connexion vers un autre compte que le sien.
    const conflit = [
      compte("victime", "partagee@chatillon92.fr"),
      compte("autre", "autre@chatillon92.fr", "partagee@chatillon92.fr"),
    ];
    assert.equal(loginDepuisAdresse(conflit, "partagee@chatillon92.fr"), "victime");
  });

  it("refuse de choisir quand deux comptes portent la même adresse", () => {
    const doublon = [
      compte("premier", "commune@chatillon92.fr"),
      compte("second", "commune@chatillon92.fr"),
    ];
    assert.equal(loginDepuisAdresse(doublon, "commune@chatillon92.fr"), null);
  });

  it("refuse aussi sur deux adresses de contact identiques", () => {
    // Deux agents d'un même foyer partageant une boîte : cas réel.
    const foyer = [
      compte("un", "un@chatillon92.fr", "famille@example.com"),
      compte("deux", "deux@chatillon92.fr", "famille@example.com"),
    ];
    assert.equal(loginDepuisAdresse(foyer, "famille@example.com"), null);
  });

  it("ne se laisse pas prendre par une adresse absente des deux champs", () => {
    assert.equal(loginDepuisAdresse([compte("x", null, null)], "vide@x.fr"), null);
  });
});
