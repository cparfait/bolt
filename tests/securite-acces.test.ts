import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientIp } from "../src/lib/net";
import { secretAcceptable } from "../src/lib/secret";
import { peutBasculerAcces } from "../src/lib/departs";

/**
 * Trois verrous dont la défaillance ouvrait plus que prévu : un secret de
 * session connu de tous, une adresse cliente choisie par le client, et un
 * gestionnaire capable de fermer l'accès d'un administrateur.
 */

const entetes = (valeurs: Record<string, string>) => new Headers(valeurs);

describe("clientIp", () => {
  it("retient l'adresse posée par le dernier proxy, pas celle fournie par le client", () => {
    // Le client envoie « X-Forwarded-For: 10.0.0.1 », un proxy qui concatène
    // ajoute la vraie adresse à droite.
    assert.equal(clientIp(entetes({ "x-forwarded-for": "10.0.0.1, 203.0.113.7" })), "203.0.113.7");
  });

  it("lit l'unique adresse d'un proxy qui écrase l'en-tête", () => {
    assert.equal(clientIp(entetes({ "x-forwarded-for": "192.168.1.20" })), "192.168.1.20");
  });

  it("normalise l'adresse IPv6-mapped et le port", () => {
    assert.equal(clientIp(entetes({ "x-forwarded-for": "::ffff:10.1.2.3" })), "10.1.2.3");
    assert.equal(clientIp(entetes({ "x-forwarded-for": "a, 10.1.2.3:5123 " })), "10.1.2.3");
  });

  it("ignore X-Real-IP, que le client pose aussi facilement", () => {
    assert.equal(clientIp(entetes({ "x-real-ip": "10.0.0.1" })), "");
  });

  it("renvoie une chaîne vide sans en-tête exploitable", () => {
    assert.equal(clientIp(entetes({})), "");
    assert.equal(clientIp(entetes({ "x-forwarded-for": " , " })), "");
  });
});

describe("secretAcceptable", () => {
  it("refuse les valeurs d'exemple publiées, malgré leur longueur", () => {
    assert.equal(secretAcceptable("changez-moi-chaine-aleatoire-de-32-caracteres-minimum"), false);
    assert.equal(secretAcceptable("bolt-dev-secret-a-changer-en-production-0123456789"), false);
  });

  it("refuse un secret absent ou trop court", () => {
    assert.equal(secretAcceptable(undefined), false);
    assert.equal(secretAcceptable(""), false);
    assert.equal(secretAcceptable("x".repeat(31)), false);
  });

  it("accepte un secret généré", () => {
    assert.equal(secretAcceptable("q8V3mZ0pT1xYc4LrN7bH2sKd9WfE6uJa+gQ="), true);
  });
});

describe("peutBasculerAcces", () => {
  it("laisse le gestionnaire fermer l'accès d'un agent, d'un animateur ou d'un gestionnaire", () => {
    for (const role of ["AGENT", "COACH", "GESTIONNAIRE"] as const) {
      assert.equal(peutBasculerAcces({ role: "GESTIONNAIRE" }, { role }), true);
    }
  });

  it("réserve à un administrateur le compte d'un administrateur", () => {
    assert.equal(peutBasculerAcces({ role: "GESTIONNAIRE" }, { role: "ADMIN" }), false);
    assert.equal(peutBasculerAcces({ role: "ADMIN" }, { role: "ADMIN" }), true);
  });
});
