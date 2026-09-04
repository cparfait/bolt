import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_GENERAL,
  domaineDesAgents,
  estAdresseDeLaCollectivite,
} from "../src/lib/settings";

/**
 * Aiguillage de l'écran d'accès.
 *
 * Une adresse du domaine de la collectivité reçoit toujours la même réponse —
 * « regardez votre messagerie » — qu'elle existe ou non. C'est ce seul test de
 * domaine qui empêche l'écran de servir à savoir qui travaille ici : sans lui,
 * on taperait des adresses jusqu'à ce que la réponse change.
 */

const cfg = (partiel: Partial<typeof DEFAULT_GENERAL>) => ({
  ...DEFAULT_GENERAL,
  ...partiel,
});

describe("domaine des agents", () => {
  it("prend la valeur explicite", () => {
    assert.equal(domaineDesAgents(cfg({ domaineAgents: "chatillon92.fr" })), "chatillon92.fr");
  });

  it("tolère un arobase de trop et les majuscules", () => {
    assert.equal(domaineDesAgents(cfg({ domaineAgents: "@Chatillon92.FR" })), "chatillon92.fr");
  });

  it("se déduit de l'adresse de contact quand rien n'est saisi", () => {
    // La collectivité qui a renseigné « sport@ville.fr » a déjà dit ce qu'il
    // fallait savoir : autant ne pas le lui redemander.
    const g = cfg({ domaineAgents: "", contactEmail: "sport@ville.fr" });
    assert.equal(domaineDesAgents(g), "ville.fr");
  });

  it("reste vide si rien ne permet de le deviner", () => {
    assert.equal(domaineDesAgents(cfg({ domaineAgents: "", contactEmail: "" })), "");
  });
});

describe("reconnaissance d'une adresse d'agent", () => {
  const g = cfg({ domaineAgents: "chatillon92.fr" });

  it("reconnaît une adresse du domaine, connue ou non de l'application", () => {
    // Le point capital : aucune consultation de l'annuaire. La réponse est la
    // même pour une adresse qui existe et pour une qui n'existe pas.
    assert.equal(estAdresseDeLaCollectivite(g, "p.dupont@chatillon92.fr"), true);
    assert.equal(estAdresseDeLaCollectivite(g, "personne.nexiste.pas@chatillon92.fr"), true);
  });

  it("ne se laisse pas berner par un domaine qui finit pareil", () => {
    // « faux-chatillon92.fr » ne doit pas passer pour le domaine de la ville.
    assert.equal(estAdresseDeLaCollectivite(g, "x@faux-chatillon92.fr"), false);
    assert.equal(estAdresseDeLaCollectivite(g, "x@chatillon92.fr.example.com"), false);
  });

  it("rejette une adresse extérieure", () => {
    assert.equal(estAdresseDeLaCollectivite(g, "quelquun@gmail.com"), false);
  });

  it("sans domaine configuré, ne reconnaît personne", () => {
    // Repli prudent : l'écran se rabat alors sur la seule question « cette
    // adresse est-elle connue de Bolt ? ».
    const vide = cfg({ domaineAgents: "", contactEmail: "" });
    assert.equal(estAdresseDeLaCollectivite(vide, "p.dupont@chatillon92.fr"), false);
  });
});
