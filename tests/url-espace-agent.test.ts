import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { DEFAULT_GENERAL, urlEspaceAgent } from "../src/lib/settings";

/**
 * Adresse de base des liens envoyés aux agents.
 *
 * Cette fonction décide où pointe le lien de connexion reçu par courriel. Se
 * tromper ici ne casse rien de visible côté serveur : l'application répond, les
 * courriels partent, le journal est vert. C'est l'agent qui, chez lui, obtient
 * un nom qui ne résout pas — et personne ne le sait avant qu'il ne rappelle. Le
 * genre de panne qu'un test attrape et qu'une relecture manque.
 */

const cfg = (partiel: Partial<typeof DEFAULT_GENERAL>) => ({
  ...DEFAULT_GENERAL,
  ...partiel,
});

afterEach(() => {
  delete process.env.PUBLIC_AGENT_ACCESS;
  delete process.env.BOLT_PUBLIC_URL;
});

describe("espace agent interne", () => {
  it("utilise l'URL du back-office", () => {
    const g = cfg({ appUrl: "https://bolt.chatillon92.fr", pointageUrl: "https://pointage.chatillon92.fr" });
    assert.equal(urlEspaceAgent(g), "https://bolt.chatillon92.fr");
  });
});

describe("espace agent publié sur Internet", () => {
  it("bascule sur l'URL publique", () => {
    process.env.PUBLIC_AGENT_ACCESS = "1";
    const g = cfg({ appUrl: "https://bolt.chatillon92.fr", pointageUrl: "https://pointage.chatillon92.fr" });
    assert.equal(urlEspaceAgent(g), "https://pointage.chatillon92.fr");
  });

  it("retombe sur l'URL du back-office si aucune URL publique n'est renseignée", () => {
    // Déploiement à un seul nom : publier ne doit pas produire une base vide,
    // qui donnerait un lien « /acces/lien?token=… » sans hôte.
    process.env.PUBLIC_AGENT_ACCESS = "1";
    const g = cfg({ appUrl: "https://bolt.chatillon92.fr", pointageUrl: "" });
    assert.equal(urlEspaceAgent(g), "https://bolt.chatillon92.fr");
  });

  it("n'est pas dupe d'une valeur autre que 1", () => {
    process.env.PUBLIC_AGENT_ACCESS = "true";
    const g = cfg({ appUrl: "https://bolt.chatillon92.fr", pointageUrl: "https://pointage.chatillon92.fr" });
    assert.equal(urlEspaceAgent(g), "https://bolt.chatillon92.fr");
  });
});

describe("forme de l'adresse produite", () => {
  it("retire la barre oblique finale", () => {
    // Les appelants concatènent « /acces/lien?token=… » : une barre en trop
    // donnerait « //acces/lien », que certains proxys normalisent et d'autres
    // non.
    const g = cfg({ appUrl: "https://bolt.chatillon92.fr///" });
    assert.equal(urlEspaceAgent(g), "https://bolt.chatillon92.fr");
  });

  it("se rabat sur BOLT_PUBLIC_URL quand rien n'est configuré", () => {
    process.env.BOLT_PUBLIC_URL = "https://depuis-env.chatillon92.fr/";
    const g = cfg({ appUrl: "", pointageUrl: "" });
    assert.equal(urlEspaceAgent(g), "https://depuis-env.chatillon92.fr");
  });
});
