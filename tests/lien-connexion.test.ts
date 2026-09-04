import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Role } from "@prisma/client";
import { autoriseDepuisInternet } from "../src/lib/magic";

/**
 * Qui peut ouvrir une session depuis Internet.
 *
 * Le gros du cloisonnement est ailleurs : `requireUser` (src/lib/session.ts)
 * refuse tout écran et toute action de gestion à une requête venue de
 * l'extérieur, quel que soit le rôle. Cette fonction-ci ne décide que du seuil,
 * et n'y arrête qu'ADMIN — en défense de profondeur, pour qu'aucune session du
 * rôle qui passe tous les contrôles ne puisse exister dehors.
 *
 * Une règle d'une ligne, dont l'inversion ne changerait l'apparence d'aucun
 * écran. Elle mérite ses tests.
 */

const roles: Role[] = ["ADMIN", "GESTIONNAIRE", "COACH", "AGENT"];

describe("connexion par lien depuis Internet", () => {
  it("autorise l'agent — c'est toute la population visée", () => {
    assert.equal(autoriseDepuisInternet("AGENT"), true);
  });

  it("autorise le gestionnaire et l'animateur, qui sont aussi des agents", () => {
    // Le service des sports est composé de gens qui font du sport. Leur fermer
    // la connexion leur fermait leurs propres inscriptions ; ce que leur
    // session peut faire est borné par `requireUser`, pas ici.
    assert.equal(autoriseDepuisInternet("GESTIONNAIRE"), true);
    assert.equal(autoriseDepuisInternet("COACH"), true);
  });

  it("arrête l'administrateur au seuil", () => {
    // Le seul rôle qui passe tous les contrôles de rôle. Il tient dans une
    // poignée de personnes, elles ont le VPN : si une action de gestion
    // échappait un jour à `requireUser`, aucune session d'administrateur ne
    // doit exister dehors pour en profiter.
    assert.equal(autoriseDepuisInternet("ADMIN"), false);
  });

  it("n'arrête qu'ADMIN, quoi qu'il arrive à l'énumération", () => {
    assert.deepEqual(roles.filter((r) => !autoriseDepuisInternet(r)), ["ADMIN"]);
  });
});
