import { prisma } from "./db";

/**
 * Référentiel des services de la collectivité.
 *
 * Il ne décrit PAS le rattachement des comptes d'annuaire : celui-là est lu
 * dans l'AD (`department` / `division`) et réécrit à chaque synchronisation
 * (src/lib/annuaire.ts). Ce référentiel sert aux personnes qui n'y figurent
 * pas — vacataires, contrats courts, agents d'un autre organisme — et qui, sans
 * lui, tapaient leur service à la main sur le bon d'inscription.
 */

/** Services proposés à la saisie, dans l'ordre choisi par le service des sports. */
export async function servicesProposes(): Promise<string[]> {
  const lignes = await prisma.service.findMany({
    where: { actif: true },
    orderBy: [{ ordre: "asc" }, { nom: "asc" }],
    select: { nom: true },
  });
  return lignes.map((l) => l.nom);
}

/**
 * Le libellé reçu correspond-il à un service du référentiel ?
 *
 * Renvoie le libellé **canonique** plutôt qu'un booléen : la comparaison est
 * insensible à la casse, et c'est l'orthographe du référentiel qui doit être
 * enregistrée. Sans quoi le formulaire ne servirait à rien — « dsi » renvoyé
 * par un client bricolé recréerait la ligne parasite qu'on cherche à éviter.
 *
 * `null` quand rien ne correspond : au dépôt, la demande est refusée. Une liste
 * fermée côté écran ne vaut rien sans le contrôle côté serveur, la valeur d'un
 * `<select>` étant aussi falsifiable que celle d'un champ libre.
 */
export async function serviceDuReferentiel(saisi: string): Promise<string | null> {
  const nom = saisi.trim();
  if (!nom) return null;
  const trouve = await prisma.service.findFirst({
    where: { actif: true, nom: { equals: nom, mode: "insensitive" } },
    select: { nom: true },
  });
  return trouve?.nom ?? null;
}
