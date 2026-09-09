import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { destinataireRefuse } from "../src/lib/mail";

/**
 * Un échec d'envoi vient-il du destinataire, ou de la messagerie ?
 *
 * La distinction décide du sort d'une campagne de rappels : une adresse
 * inconnue s'écarte et la campagne continue ; un plafond de débit ou une panne
 * l'interrompt pour reprendre plus tard. Confondre les deux dans un sens
 * réessaie sans fin une adresse morte, dans l'autre abandonne des agents
 * joignables — et c'est ce second cas qui s'est produit.
 */

const erreur = (code: string, responseCode?: number) =>
  Object.assign(new Error("x"), { code, responseCode });

describe("classement des échecs SMTP", () => {
  it("écarte une adresse rejetée définitivement sur l'enveloppe", () => {
    assert.equal(destinataireRefuse(erreur("EENVELOPE", 550)), true);
    assert.equal(destinataireRefuse(erreur("EENVELOPE", 553)), true);
  });

  it("retient pour plus tard un refus temporaire, même sur l'enveloppe", () => {
    // « 4.4.2 message submission rate exceeded » — Microsoft 365 au-delà du plafond.
    assert.equal(destinataireRefuse(erreur("EENVELOPE", 451)), false);
    assert.equal(destinataireRefuse(erreur("EENVELOPE", 421)), false);
  });

  it("ne rejette jamais un destinataire pour une panne qui vaut pour tous", () => {
    assert.equal(destinataireRefuse(erreur("EAUTH", 535)), false);
    assert.equal(destinataireRefuse(erreur("ECONNECTION")), false);
    assert.equal(destinataireRefuse(erreur("EMESSAGE", 552)), false);
    assert.equal(destinataireRefuse(new Error("ECONNREFUSED")), false);
    assert.equal(destinataireRefuse(null), false);
  });
});
