import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Role } from "@prisma/client";
import { autoriseDepuisInternet } from "../src/lib/magic";

/**
 * Qui peut ouvrir une session depuis Internet.
 *
 * Le cloisonnement du proxy porte sur les chemins, et une action serveur n'est
 * pas liée au chemin qui l'affiche : une session de gestionnaire obtenue depuis
 * l'extérieur permettrait d'appeler les actions du back-office depuis un chemin
 * publié. Bloquer les écrans ne suffit donc pas — il faut empêcher la session
 * privilégiée de naître, et c'est cette fonction qui le décide.
 *
 * Une règle d'une ligne, mais dont l'inversion ouvrirait le back-office à
 * Internet sans qu'aucun écran ne change d'apparence. Elle mérite ses tests.
 */

const roles: Role[] = ["ADMIN", "GESTIONNAIRE", "COACH", "AGENT"];

describe("connexion par lien depuis Internet", () => {
  it("autorise l'agent — c'est toute la population visée", () => {
    assert.equal(autoriseDepuisInternet("AGENT"), true);
  });

  it("refuse les rôles qui ouvrent des écrans de gestion", () => {
    // COACH compris : le rôle donne accès au planning. Les animateurs
    // prestataires ne passent pas par ce mécanisme mais par leur jeton et leur
    // PIN — rien ne change pour eux.
    assert.equal(autoriseDepuisInternet("ADMIN"), false);
    assert.equal(autoriseDepuisInternet("GESTIONNAIRE"), false);
    assert.equal(autoriseDepuisInternet("COACH"), false);
  });

  it("n'autorise qu'un seul rôle, quoi qu'il arrive à l'énumération", () => {
    // Un rôle ajouté plus tard sera refusé par défaut. C'est le bon sens du
    // défaut : se tromper coûte un agent qui appelle le service, pas un
    // back-office ouvert sur Internet.
    assert.deepEqual(roles.filter(autoriseDepuisInternet), ["AGENT"]);
  });
});
