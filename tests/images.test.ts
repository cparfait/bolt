import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dimensionsImage, redimensionner } from "../src/lib/images";

/**
 * Bornage du logo dans les courriels.
 *
 * Outlook rend le HTML avec le moteur de Word, qui ignore `max-height` : sans
 * dimensions lues ici et posées en attributs, un logo de 1200 px s'affiche à
 * 1200 px et chasse le message hors de l'écran. Ces fonctions sont pures pour
 * être vérifiables sans messagerie ni base.
 */

/** PNG minimal : signature + en-tête IHDR aux dimensions voulues. */
function png(largeur: number, hauteur: number): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buf, 0);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(largeur, 16);
  buf.writeUInt32BE(hauteur, 20);
  return buf;
}

/** JPEG minimal : un segment quelconque à sauter, puis la trame SOF0. */
function jpeg(largeur: number, hauteur: number): Buffer {
  const commentaire = Buffer.from([0xff, 0xfe, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(9, 2); // longueur du segment
  sof.writeUInt8(8, 4); // précision
  sof.writeUInt16BE(hauteur, 5);
  sof.writeUInt16BE(largeur, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), commentaire, sof, Buffer.alloc(8)]);
}

/** WebP sans perte (VP8L) : dimensions sur 14 bits, décalées de 1. */
function webpVP8L(largeur: number, hauteur: number): Buffer {
  const buf = Buffer.alloc(32);
  buf.write("RIFF", 0, "ascii");
  buf.write("WEBP", 8, "ascii");
  buf.write("VP8L", 12, "ascii");
  buf.writeUInt32LE((largeur - 1) | ((hauteur - 1) << 14), 21);
  return buf;
}

describe("dimensionsImage", () => {
  it("lit un PNG", () => {
    assert.deepEqual(dimensionsImage(png(1200, 900)), { largeur: 1200, hauteur: 900 });
  });

  it("lit un JPEG en sautant les segments qui précèdent la trame", () => {
    assert.deepEqual(dimensionsImage(jpeg(640, 480)), { largeur: 640, hauteur: 480 });
  });

  it("lit un WebP sans perte", () => {
    assert.deepEqual(dimensionsImage(webpVP8L(300, 100)), { largeur: 300, hauteur: 100 });
  });

  it("renvoie null sur un contenu non reconnu plutôt que d'échouer", () => {
    // Un logo illisible doit partir sans dimensions, pas faire manquer l'envoi.
    assert.equal(dimensionsImage(Buffer.from("ceci n'est pas une image")), null);
    assert.equal(dimensionsImage(png(1200, 900).subarray(0, 12)), null);
    assert.equal(dimensionsImage(Buffer.alloc(0)), null);
  });
});

describe("redimensionner", () => {
  it("ramène à la hauteur voulue en gardant les proportions", () => {
    assert.deepEqual(redimensionner({ largeur: 1200, hauteur: 900 }, 44), {
      largeur: 59,
      hauteur: 44,
    });
  });

  it("n'agrandit jamais une image déjà plus petite", () => {
    const petit = { largeur: 30, hauteur: 20 };
    assert.deepEqual(redimensionner(petit, 44), petit);
  });

  it("garde au moins un pixel de large sur une image très allongée", () => {
    assert.deepEqual(redimensionner({ largeur: 2, hauteur: 4000 }, 44), {
      largeur: 1,
      hauteur: 44,
    });
  });

  it("se tait sur des dimensions absentes ou aberrantes", () => {
    assert.equal(redimensionner(null, 44), null);
    assert.equal(redimensionner({ largeur: 0, hauteur: 0 }, 44), null);
  });
});
