import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { rateLimit, resetRateLimit } from "../src/lib/rate-limit";
import { estInterne } from "../src/lib/net";

/**
 * Plafond global d'envoi des liens de connexion.
 *
 * Les deux compteurs qui existaient sont indexés sur une identité — une
 * adresse, une IP. Une source distribuée les contourne en faisant varier les
 * deux, sans qu'aucun ne se remplisse jamais. Le plafond global est le seul à
 * borner le total ; ces tests portent sur ses deux ressorts : le comptage, et
 * la réserve qui l'empêche de gêner les agents du réseau.
 */

const CLE = "test:plafond";

afterEach(() => {
  resetRateLimit(CLE);
  delete process.env.INTERNAL_CIDRS;
});

describe("comptage du plafond", () => {
  it("laisse passer exactement le nombre autorisé, puis refuse", () => {
    for (let n = 1; n <= 5; n++) {
      assert.equal(rateLimit(CLE, 5, 3600).ok, true, `la demande n°${n} devait passer`);
    }
    assert.equal(rateLimit(CLE, 5, 3600).ok, false, "la 6e devait être refusée");
  });

  it("indique dans combien de temps réessayer", () => {
    for (let n = 0; n < 5; n++) rateLimit(CLE, 5, 3600);
    const refus = rateLimit(CLE, 5, 3600);
    assert.equal(refus.ok, false);
    assert.ok(refus.retryAfterSec > 0 && refus.retryAfterSec <= 3600);
  });

  it("compte sans distinguer la source : c'est tout son intérêt", () => {
    // Le seau n'a pas de clé d'identité. Mille adresses IP différentes
    // remplissent donc le même compteur — l'angle mort que les compteurs par
    // adresse et par IP laissaient ouvert.
    for (let n = 0; n < 3; n++) rateLimit(CLE, 3, 3600);
    assert.equal(rateLimit(CLE, 3, 3600).ok, false);
  });

  it("repart à zéro une fois la fenêtre écoulée", () => {
    // Fenêtre nulle : la suivante est immédiatement une nouvelle période.
    assert.equal(rateLimit(CLE, 1, 0).ok, true);
    assert.equal(rateLimit(CLE, 1, 0).ok, true);
  });
});

describe("réserve pour le réseau de la collectivité", () => {
  it("ne considère pas comme externe une adresse des plages internes", () => {
    // Le plafond ne s'applique qu'à `!estInterne(ip)` : pendant une attaque,
    // un agent au bureau ou en VPN doit continuer à recevoir son lien.
    process.env.INTERNAL_CIDRS = "10.0.0.0/8,192.168.0.0/16";
    assert.equal(estInterne("10.12.0.4"), true);
    assert.equal(estInterne("192.168.1.20"), true);
  });

  it("considère comme externe ce qui vient d'ailleurs", () => {
    process.env.INTERNAL_CIDRS = "10.0.0.0/8";
    assert.equal(estInterne("45.147.211.2"), false);
    assert.equal(estInterne("172.16.0.1"), false);
  });

  it("sans plage déclarée, tout est interne — donc aucun plafond", () => {
    // Déploiement strictement interne : le cloisonnement n'est pas demandé, et
    // le plafond n'aurait rien à protéger.
    assert.equal(estInterne("45.147.211.2"), true);
  });
});
