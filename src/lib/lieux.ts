import { prisma } from "./db";

/**
 * Le lieu d'un créneau n'est qu'un libellé (`Creneau.lieu`), volontairement
 * sans clé étrangère : l'historique garde le lieu tel qu'il était (voir
 * prisma/schema.prisma, modèle Lieu). L'adresse, elle, vit dans le
 * référentiel des lieux. Ce module fait le pont : d'un libellé, retrouver
 * l'adresse, et de l'adresse, un lien qui ouvre le GPS du téléphone.
 */

/**
 * Lien d'itinéraire vers une adresse.
 *
 * L'URL universelle de Google Maps : sur Android elle ouvre l'application
 * Maps (ou propose Waze, si installé) ; sur iPhone elle ouvre Google Maps si
 * présent, sinon le site, d'où l'on bascule vers Plans. Un lien `geo:` ne
 * fonctionnerait que sur Android, un lien Plans que sur iPhone — celui-ci
 * marche partout, et n'a besoin d'aucune clé.
 */
export function lienItineraire(adresse: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adresse.trim())}`;
}

/** Libellé → adresse, pour tous les lieux qui en ont une, actifs ou non. */
export async function adressesDesLieux(): Promise<Map<string, string>> {
  const lieux = await prisma.lieu.findMany({
    where: { adresse: { not: null } },
    select: { nom: true, adresse: true },
  });
  return new Map(lieux.filter((l) => l.adresse?.trim()).map((l) => [l.nom, l.adresse!.trim()]));
}

/** Adresse d'un lieu désigné par son libellé, ou null. */
export async function adresseDuLieu(lieu: string | null | undefined): Promise<string | null> {
  if (!lieu) return null;
  const l = await prisma.lieu.findUnique({ where: { nom: lieu }, select: { adresse: true } });
  return l?.adresse?.trim() || null;
}

/** Lien d'itinéraire pour un libellé de lieu, ou null s'il n'a pas d'adresse. */
export function itineraireDe(
  lieu: string | null | undefined,
  adresses: Map<string, string>,
): string | null {
  if (!lieu) return null;
  const adresse = adresses.get(lieu);
  return adresse ? lienItineraire(adresse) : null;
}

/** Lien d'itinéraire pour un libellé de lieu, en une requête — ou null. */
export async function lienItineraireDuLieu(lieu: string | null | undefined): Promise<string | null> {
  const adresse = await adresseDuLieu(lieu);
  return adresse ? lienItineraire(adresse) : null;
}
