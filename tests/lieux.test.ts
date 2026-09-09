import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { itineraireDe, lienItineraire } from "../src/lib/lieux";

describe("itinéraire vers un lieu", () => {
  it("construit une adresse universelle que le téléphone ouvre dans son GPS", () => {
    const url = lienItineraire("12 rue de la Piscine, 92320 Châtillon");
    assert.match(url, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    assert.match(url, /Ch%C3%A2tillon/);
    assert.doesNotMatch(url, /\s/);
  });

  it("ne propose rien sans adresse connue", () => {
    const adresses = new Map([["Gymnase municipal", "1 avenue du Stade"]]);
    assert.ok(itineraireDe("Gymnase municipal", adresses));
    assert.equal(itineraireDe("Piscine", adresses), null);
    assert.equal(itineraireDe(null, adresses), null);
  });
});
