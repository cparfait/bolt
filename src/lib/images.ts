/**
 * Lecture des dimensions d'une image, sans décodage ni dépendance.
 *
 * Isolé de `src/lib/mail.ts` pour rester vérifiable en test pur : le module
 * mail ouvre une connexion à la base par ses réglages, ces fonctions-ci ne
 * demandent qu'un Buffer.
 */

export type Dimensions = { largeur: number; hauteur: number };

/**
 * Ramène des dimensions réelles sous une hauteur maximale, en conservant les
 * proportions. Une image déjà plus petite n'est jamais agrandie : la grossir
 * ne ferait qu'exhiber ses pixels.
 */
export function redimensionner(
  reelles: Dimensions | null,
  hauteurMax: number,
): Dimensions | null {
  if (!reelles || reelles.largeur <= 0 || reelles.hauteur <= 0) return null;
  if (reelles.hauteur <= hauteurMax) return reelles;
  return {
    largeur: Math.max(1, Math.round((reelles.largeur * hauteurMax) / reelles.hauteur)),
    hauteur: hauteurMax,
  };
}

/**
 * Dimensions d'une image PNG, JPEG ou WebP, lues dans son en-tête.
 *
 * On ne lit que les octets d'en-tête, sans décoder l'image ni ajouter de
 * dépendance : les trois formats matriciels acceptés à l'envoi
 * (`src/lib/actions/parametres.ts`) annoncent leur taille dans leurs premiers
 * octets. Renvoie `null` sur un fichier tronqué ou exotique — l'appelant sait
 * s'en passer.
 */
export function dimensionsImage(buf: Buffer): Dimensions | null {
  try {
    // PNG : signature de 8 octets, puis le bloc IHDR qui ouvre toujours le
    // fichier — largeur et hauteur en gros-boutiste aux offsets 16 et 20.
    if (buf.length >= 24 && buf.toString("hex", 0, 8) === "89504e470d0a1a0a") {
      return { largeur: buf.readUInt32BE(16), hauteur: buf.readUInt32BE(20) };
    }

    // JPEG : parcours des segments jusqu'au marqueur de trame (SOFn), seul à
    // porter les dimensions. Les autres se sautent par leur longueur.
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null;
        // Des 0xFF de bourrage peuvent précéder le marqueur.
        while (buf[i + 1] === 0xff && i + 2 < buf.length) i += 1;
        const marqueur = buf[i + 1];
        const estTrame =
          marqueur >= 0xc0 &&
          marqueur <= 0xcf &&
          // C4 (tables de Huffman), C8 (extension) et CC (codage arithmétique)
          // tombent dans le même intervalle sans être des trames.
          marqueur !== 0xc4 &&
          marqueur !== 0xc8 &&
          marqueur !== 0xcc;
        if (estTrame) {
          return { largeur: buf.readUInt16BE(i + 7), hauteur: buf.readUInt16BE(i + 5) };
        }
        const longueur = buf.readUInt16BE(i + 2);
        if (longueur < 2) return null;
        i += 2 + longueur;
      }
      return null;
    }

    // WebP : conteneur RIFF, trois en-têtes possibles selon l'encodage.
    if (
      buf.length >= 30 &&
      buf.toString("ascii", 0, 4) === "RIFF" &&
      buf.toString("ascii", 8, 12) === "WEBP"
    ) {
      const bloc = buf.toString("ascii", 12, 16);
      if (bloc === "VP8 ") {
        return {
          largeur: buf.readUInt16LE(26) & 0x3fff,
          hauteur: buf.readUInt16LE(28) & 0x3fff,
        };
      }
      if (bloc === "VP8L") {
        const bits = buf.readUInt32LE(21);
        return { largeur: (bits & 0x3fff) + 1, hauteur: ((bits >>> 14) & 0x3fff) + 1 };
      }
      if (bloc === "VP8X") {
        return { largeur: buf.readUIntLE(24, 3) + 1, hauteur: buf.readUIntLE(27, 3) + 1 };
      }
    }
    return null;
  } catch {
    // En-tête tronqué : pas de dimensions, mais pas d'envoi manqué pour autant.
    return null;
  }
}
