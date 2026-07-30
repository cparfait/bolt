import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { participeALaSeance } from "../src/lib/inscriptions";
import { placesOffertes } from "../src/lib/stats";
import { adresseDeContact } from "../src/lib/comptes";
import { pinFaible } from "../src/lib/coach-access";
import { pluriel, prenomDe } from "../src/lib/constants";
import { jourUtc } from "../src/lib/dates";

/**
 * Règles pures dont dépendent la feuille d'émargement et les statistiques.
 * `participeALaSeance` décide qui figure sur une feuille et sur quelles séances
 * porte l'assiduité d'un agent : une erreur ici se propage partout.
 */

describe("participeALaSeance", () => {
  const seance = jourUtc("2026-09-15");

  it("compte à partir du jour de la décision, celui-ci inclus", () => {
    const i = { demandeAt: jourUtc("2026-09-01"), decisionAt: jourUtc("2026-09-15") };
    assert.equal(participeALaSeance(i, seance), true);
  });

  it("écarte les séances antérieures à l'inscription", () => {
    const i = { demandeAt: jourUtc("2026-09-01"), decisionAt: jourUtc("2026-09-16") };
    assert.equal(participeALaSeance(i, seance), false);
  });

  it("retombe sur la demande quand aucune décision n'a été prise", () => {
    assert.equal(
      participeALaSeance({ demandeAt: jourUtc("2026-09-01"), decisionAt: null }, seance),
      true,
    );
    assert.equal(
      participeALaSeance({ demandeAt: jourUtc("2026-10-01"), decisionAt: null }, seance),
      false,
    );
  });

  it("compare des jours, pas des instants", () => {
    // Inscrit à 18 h pour une séance du matin : la journée compte quand même,
    // sans quoi l'agent manquerait à sa propre première feuille.
    const i = { demandeAt: new Date("2026-09-15T18:30:00Z"), decisionAt: null };
    assert.equal(participeALaSeance(i, seance), true);
  });
});

describe("placesOffertes", () => {
  const creneau = (capacite: number, partagee: boolean, activite: number | null) => ({
    creneau: { capacite, activite: { capacitePartagee: partagee, capacite: activite } },
  });

  it("prend la capacité du créneau par défaut", () => {
    assert.equal(placesOffertes(creneau(20, false, 99)), 20);
  });

  it("prend celle du groupe quand l'activité mutualise", () => {
    assert.equal(placesOffertes(creneau(20, true, 12)), 12);
  });

  it("retombe sur le créneau si le groupe n'a pas d'effectif déclaré", () => {
    assert.equal(placesOffertes(creneau(20, true, null)), 20);
  });
});

describe("adresseDeContact", () => {
  it("préfère l'adresse saisie par le service à celle de l'annuaire", () => {
    assert.equal(
      adresseDeContact({ email: "a.dupont@collectivite.fr", emailContact: "dupont@gmail.com" }),
      "dupont@gmail.com",
    );
  });

  it("retombe sur l'annuaire quand rien n'est saisi", () => {
    assert.equal(
      adresseDeContact({ email: "a.dupont@collectivite.fr", emailContact: null }),
      "a.dupont@collectivite.fr",
    );
  });

  it("ignore un champ rempli d'espaces", () => {
    // Un champ vidé côté formulaire arrive parfois en chaîne blanche : le
    // laisser passer produirait un envoi à une adresse vide.
    assert.equal(
      adresseDeContact({ email: "a.dupont@collectivite.fr", emailContact: "   " }),
      "a.dupont@collectivite.fr",
    );
  });

  it("renvoie null quand l'agent est injoignable", () => {
    assert.equal(adresseDeContact({ email: null, emailContact: null }), null);
    assert.equal(adresseDeContact({ email: "", emailContact: "" }), null);
  });
});

describe("pinFaible", () => {
  it("refuse ce qui se devine", () => {
    assert.ok(pinFaible("111111"));
    assert.ok(pinFaible("123456"));
    assert.ok(pinFaible("654321"));
    assert.ok(pinFaible("121212"));
    assert.ok(pinFaible("123123"));
    assert.ok(pinFaible("102030"));
  });

  it("exige exactement six chiffres", () => {
    assert.ok(pinFaible("12345"));
    assert.ok(pinFaible("1234567"));
    assert.ok(pinFaible("12a456"));
  });

  it("accepte un code quelconque", () => {
    assert.equal(pinFaible("428617"), null);
    assert.equal(pinFaible("093184"), null);
  });
});

describe("pluriel", () => {
  it("garde le singulier à zéro, comme le veut l'usage français", () => {
    assert.equal(pluriel(0, "séance"), "séance");
    assert.equal(pluriel(1, "séance"), "séance");
    assert.equal(pluriel(2, "séance"), "séances");
  });

  it("accepte un pluriel irrégulier", () => {
    assert.equal(pluriel(2, "créneau", "créneaux"), "créneaux");
    assert.equal(pluriel(1, "est", "sont"), "est");
  });
});

describe("prenomDe", () => {
  // L'annuaire de la collectivité présente « NOM Prénom », nom de famille en
  // capitales. Prendre le premier mot donnait « Bonjour PARFAIT » sur le tableau
  // de bord et en tête de chaque courriel. La règle s'appuie donc sur la casse,
  // qui est le vrai signal, et non sur l'ordre des mots.
  it("saute le nom de famille en capitales", () => {
    assert.equal(prenomDe("PARFAIT Christophe"), "Christophe");
    assert.equal(prenomDe("BOULIOL Christine"), "Christine");
  });

  it("accepte aussi l'ordre inverse", () => {
    assert.equal(prenomDe("Christine BOULIOL"), "Christine");
  });

  it("traverse les particules en capitales", () => {
    assert.equal(prenomDe("DE LA TOUR Pierre"), "Pierre");
  });

  it("garde le premier mot quand rien ne distingue", () => {
    assert.equal(prenomDe("Jean Dupont"), "Jean");
    assert.equal(prenomDe("Administrateur local"), "Administrateur");
  });

  it("retombe sur le premier mot si tout est en capitales", () => {
    // Aucun signal : il n'y a rien à deviner, et mieux vaut un nom qu'un vide.
    assert.equal(prenomDe("JEAN DUPONT"), "JEAN");
  });

  it("gère un nom d'un seul mot, et les espaces superflus", () => {
    assert.equal(prenomDe("Cher"), "Cher");
    assert.equal(prenomDe("  PARFAIT   Christophe  "), "Christophe");
  });

  it("n'est pas trompé par les accents", () => {
    assert.equal(prenomDe("MÜLLER Éric"), "Éric");
    assert.equal(prenomDe("LE GOFF Anaïs"), "Anaïs");
  });
});
