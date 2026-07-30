import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estUnDepart, lectureJugeeIncomplete } from "../src/lib/annuaire";
import { adosseALAnnuaire } from "../src/lib/departs";
import { estHorsAnnuaire } from "../src/lib/comptes";

/**
 * Garde-fous de la prise en compte des départs.
 *
 * Ces trois fonctions décident si la synchronisation a le droit de désactiver
 * des comptes et de retirer des inscriptions. Une erreur ici ne produit pas un
 * affichage faux : elle efface les activités d'un service entier. Elles sont
 * pures exprès, pour être vérifiables sans annuaire ni base.
 */

describe("lectureJugeeIncomplete", () => {
  it("croit une lecture qui retrouve tous les témoins", () => {
    assert.equal(lectureJugeeIncomplete(50, 50), false);
  });

  it("tolère quelques absents : des départs réels, précisément", () => {
    // 45/50 = 90 %, au-dessus du seuil de 80 % : cinq personnes sont
    // effectivement parties, et doivent être traitées.
    assert.equal(lectureJugeeIncomplete(50, 45), false);
  });

  it("refuse de conclure quand la lecture perd trop de témoins", () => {
    // Base DN mal recopié, groupe filtrant trop étroit, lecture interrompue :
    // 30/50 = 60 %. Ce n'est pas un exode, c'est une erreur de configuration.
    assert.equal(lectureJugeeIncomplete(50, 30), true);
  });

  it("refuse une lecture vide alors que des témoins existent", () => {
    assert.equal(lectureJugeeIncomplete(50, 0), true);
  });

  it("accepte l'absence de témoin : première installation", () => {
    // Rien à comparer — et aucun compte n'est candidat au départ de toute façon.
    assert.equal(lectureJugeeIncomplete(0, 0), false);
  });

  it("tient exactement au seuil", () => {
    assert.equal(lectureJugeeIncomplete(10, 8), false); // 80 % : accepté
    assert.equal(lectureJugeeIncomplete(10, 7), true); // 70 % : refusé
  });
});

describe("estUnDepart", () => {
  it("garde un compte présent et actif dans l'annuaire", () => {
    assert.equal(estUnDepart({ enabled: true }, false), false);
  });

  it("ferme un compte que l'annuaire déclare désactivé", () => {
    assert.equal(estUnDepart({ enabled: false }, false), true);
  });

  it("ferme un compte désactivé même si la lecture est incomplète", () => {
    // L'annuaire l'affirme : ce n'est pas une déduction tirée d'une absence.
    assert.equal(estUnDepart({ enabled: false }, true), true);
  });

  it("ferme un compte absent d'une lecture jugée complète", () => {
    assert.equal(estUnDepart(undefined, false), true);
  });

  it("épargne un compte absent d'une lecture jugée incomplète", () => {
    // Le cas qui protège du désastre.
    assert.equal(estUnDepart(undefined, true), false);
  });
});

describe("adosseALAnnuaire", () => {
  it("retient un compte Active Directory", () => {
    assert.equal(adosseALAnnuaire({ isLocal: false, login: "jdupont" }), true);
  });

  it("écarte un compte local", () => {
    // Administrateur de secours, animateur en accès LOCAL : aucune existence
    // dans l'AD, et une synchronisation ne doit pas les fermer.
    assert.equal(adosseALAnnuaire({ isLocal: true, login: "admin" }), false);
  });

  it("écarte un participant hors annuaire", () => {
    // Élus, stagiaires, invités d'un organisme partenaire. Sans cette
    // exclusion, la première synchronisation les désactiverait tous.
    assert.equal(adosseALAnnuaire({ isLocal: false, login: "no_ad.jean.martin" }), false);
    assert.equal(adosseALAnnuaire({ isLocal: false, login: "NO_AD.Jean.Martin" }), false);
  });
});

describe("estHorsAnnuaire — qui peut recevoir une adresse de contact", () => {
  // Cette même règle garde `modifierEmailAgent`. L'adresse de contact prime sur
  // celle de l'annuaire pour l'envoi du lien de connexion : la poser sur un
  // compte qui a un autre chemin d'authentification permettrait de se faire
  // adresser son lien, donc d'ouvrir sa session. La permission se lit en liste
  // blanche, et cette liste est celle des comptes sans aucun autre accès.
  it("autorise un participant créé hors annuaire", () => {
    assert.equal(estHorsAnnuaire("no_ad.jean.martin"), true);
  });

  it("refuse un compte de l'annuaire", () => {
    assert.equal(estHorsAnnuaire("c.bouliol"), false);
  });

  it("refuse l'administrateur de secours", () => {
    // Compte local, avec mot de passe : la cible d'élévation la plus
    // intéressante. Un filtrage sur la seule origine annuaire l'aurait laissé
    // passer.
    assert.equal(estHorsAnnuaire("admin"), false);
  });

  it("ne se laisse pas contourner par la casse", () => {
    assert.equal(estHorsAnnuaire("NO_AD.Jean"), true);
  });

  it("ne confond pas un préfixe approchant", () => {
    assert.equal(estHorsAnnuaire("noad.jean"), false);
    assert.equal(estHorsAnnuaire("no_admin"), false);
  });
});
