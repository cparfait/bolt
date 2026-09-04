import { dimensionsImage } from "./images";

/**
 * Réduction du logo, une fois pour toutes, au moment de l'enregistrer.
 *
 * Le logo part en pièce jointe dans CHAQUE courriel — lien de connexion, rappel
 * de séance, annonce d'annulation, avis d'inscription. Stocké tel qu'il a été
 * téléversé, c'est un fichier de 300 Ko qui accompagne un message de deux
 * kilo-octets, à chaque envoi et pour chaque destinataire. Il est aussi servi à
 * chaque affichage des écrans de connexion, où il voyage en data URI dans le
 * HTML de la page.
 *
 * Rien de tout cela n'échoue : ça rame, discrètement, et on cherche la lenteur
 * du côté du réseau ou de la messagerie.
 *
 * La réduction se fait donc à l'enregistrement, jamais à l'envoi : le travail
 * est fait une fois plutôt qu'à chaque destinataire.
 */

/**
 * Hauteur conservée, en pixels.
 *
 * Le logo s'affiche à 44 px dans les courriels et à 80 px sur les écrans de
 * connexion. 160 px laisse le double du plus grand des deux, pour les écrans à
 * forte densité — au-delà, on transporte des pixels que personne ne voit.
 */
const HAUTEUR_MAX = 160;

/** Largeur maximale, pour un logo très allongé — un bandeau, une signature. */
const LARGEUR_MAX = 640;

/**
 * Réduit un logo en data URI. Renvoie l'original inchangé si rien n'est à
 * faire, ou si la réduction échoue : un logo trop lourd vaut mieux que pas de
 * logo du tout, et cette fonction est appelée en enregistrant des paramètres
 * dont le logo n'est qu'un champ parmi d'autres.
 */
export async function reduireLogo(dataUri: string): Promise<string> {
  // Le SVG n'est pas matriciel — et il n'est de toute façon pas affiché par les
  // messageries, qui reçoivent alors un courriel sans logo plutôt qu'une icône
  // cassée. On n'y touche pas.
  const m = dataUri.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!m) return dataUri;

  const original = Buffer.from(m[2], "base64");
  const taille = dimensionsImage(original);
  if (taille && taille.hauteur <= HAUTEUR_MAX && taille.largeur <= LARGEUR_MAX) {
    return dataUri;
  }

  try {
    // Chargement paresseux, et dans le try : `sharp` est un module natif, et
    // le traçage de dépendances de la construction autonome pourrait ne pas
    // emporter son binaire. En import statique, son absence casserait l'écran
    // des paramètres tout entier ; ici, elle rend simplement le logo inchangé.
    const { default: sharp } = await import("sharp");

    const redimensionne = sharp(original).resize({
      height: HAUTEUR_MAX,
      width: LARGEUR_MAX,
      fit: "inside",
      withoutEnlargement: true,
    });

    // Le JPEG reste JPEG : un logo photographique repasserait en PNG plus lourd
    // que l'original. Tout le reste devient PNG, qui garde la transparence —
    // un logo sur fond blanc dans un courriel à fond blanc, ça se voit.
    const sortie =
      m[1] === "image/jpeg"
        ? { mime: "image/jpeg", buf: await redimensionne.jpeg({ quality: 82 }).toBuffer() }
        : { mime: "image/png", buf: await redimensionne.png({ compressionLevel: 9 }).toBuffer() };

    // Une réduction qui alourdit n'a pas lieu d'être : cela arrive sur une
    // petite image déjà optimisée, ou très bruitée.
    if (sortie.buf.length >= original.length) return dataUri;

    return `data:${sortie.mime};base64,${sortie.buf.toString("base64")}`;
  } catch {
    return dataUri;
  }
}
