import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apercu, avecLiens, echapper } from "../src/lib/mail";

/**
 * Gabarit des courriels.
 *
 * Deux fonctions y méritent des tests : celle qui rend les adresses cliquables,
 * parce qu'elle s'applique à du texte qui vient en partie des gestionnaires, et
 * celle qui compose la ligne d'aperçu, parce qu'une erreur y est invisible à la
 * relecture — elle ne s'affiche que dans la liste des messages.
 */

describe("avecLiens", () => {
  it("rend une adresse cliquable", () => {
    const html = avecLiens("Lien : https://bolt.chatillon92.fr/acces/lien?token=abc");
    assert.match(html, /<a href="https:\/\/bolt\.chatillon92\.fr\/acces\/lien\?token=abc"/);
  });

  it("s'arrête à la ponctuation qui termine la phrase", () => {
    // Sans cela, le point final entrerait dans l'adresse et le lien tomberait
    // sur une page inexistante.
    const html = avecLiens("Rendez-vous sur https://exemple.fr/page.");
    assert.match(html, />https:\/\/exemple\.fr\/page<\/a>\./);
  });

  it("laisse le texte ordinaire intact", () => {
    assert.equal(avecLiens("Aucune adresse ici."), "Aucune adresse ici.");
  });

  it("ignore les schémas autres que http et https", () => {
    // `javascript:` dans un href serait exécuté au clic par certains clients.
    const html = avecLiens("javascript:alert(1)");
    assert.equal(html.includes("<a"), false);
  });

  it("ne peut pas sortir de l'attribut href, le texte étant déjà échappé", () => {
    // L'ordre compte : on échappe, PUIS on transforme en lien. L'inverse
    // laisserait un guillemet fermer l'attribut et ouvrir un gestionnaire
    // d'événement.
    const html = avecLiens(echapper('https://x.fr/" onmouseover="alert(1)'));
    assert.equal(html.includes('" onmouseover='), false);
    assert.equal(html.includes("<script"), false);
  });
});

describe("apercu", () => {
  it("saute la salutation pour prendre la première phrase utile", () => {
    // « Bonjour Christophe, » en aperçu ne distingue aucun message d'un autre.
    const corps = "Bonjour Christophe,\n\nVotre inscription à Yoga est confirmée.\n\nÀ bientôt.";
    assert.equal(apercu(corps), "Votre inscription à Yoga est confirmée.");
  });

  it("recolle les retours à la ligne d'un même paragraphe", () => {
    assert.equal(apercu("Bonjour,\n\nLien : abc\nCode : 123"), "Lien : abc Code : 123");
  });

  it("tronque proprement un paragraphe trop long", () => {
    const long = `Bonjour,\n\n${"a".repeat(300)}`;
    const res = apercu(long);
    assert.equal(res.length, 140);
    assert.match(res, /…$/);
  });

  it("retombe sur la salutation s'il n'y a rien d'autre", () => {
    assert.equal(apercu("Bonjour Christophe,"), "Bonjour Christophe,");
  });

  it("ne casse pas sur un corps vide", () => {
    assert.equal(apercu(""), "");
  });
});
