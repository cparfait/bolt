import { prisma } from "./db";

/**
 * Référentiel des services de la collectivité, et regroupement des libellés.
 *
 * Deux tables, deux rôles distincts, et c'est ce qui fait tenir l'ensemble :
 *
 *  • le **référentiel** (`Service`) est la liste que la collectivité reconnaît.
 *    Elle se prépare AVANT de savoir ce que contient l'annuaire, et c'est elle
 *    qu'on propose sur le bon d'inscription ;
 *  • le **regroupement** (`RegroupementService`) dit « ce libellé-là désigne ce
 *    service-ci ». Un annuaire réel n'écrit pas deux fois le même service de la
 *    même façon : « Crèche La Cigogne » et « Crèche Petit Poucet » relèvent de
 *    la petite enfance, « CTM » désigne le centre technique municipal sans
 *    partager un caractère avec lui.
 *
 * Le libellé brut n'est jamais écrasé : celui d'un compte d'annuaire reste dans
 * le miroir (`AdAccount.service`), celui d'une personne hors annuaire dans sa
 * demande. `User.service` est donc un **résultat**, recalculé à chaque
 * synchronisation — on peut rejouer un regroupement à tout moment sans rien
 * réimporter, et se tromper de règle ne coûte que de la corriger.
 */

export const normaliser = (nom: string | null | undefined): string =>
  String(nom ?? "").replace(/\s+/g, " ").trim();

/**
 * Clé de comparaison, insensible à la casse, aux accents, à la ponctuation et
 * au pluriel. « Services Techniques », « Service Technique » et « service
 * techniques » donnent la même clé, tout comme « Population & Citoyenneté » et
 * « Population et Citoyenneté ».
 *
 * Ces variantes ne sont pas des cas limites : un annuaire est rempli à la main
 * sur des années, par des personnes différentes. Comparer les libellés bruts
 * créerait un service par graphie, ce que ce référentiel existe pour éviter.
 */
export function cleComparaison(nom: string | null | undefined): string {
  return String(nom ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((mot) => mot.replace(/s$/, ""))
    .join(" ");
}

/**
 * Analyse un collage : une ligne par service, ou une liste séparée par des
 * virgules ou des points-virgules. Le numéro en tête de ligne est retiré — une
 * liste copiée depuis un organigramme en porte presque toujours un.
 *
 * Saisir quarante services un par un dans un formulaire est le genre de tâche
 * qu'on ne finit pas : la liste existe déjà quelque part, elle doit pouvoir
 * entrer d'un seul geste.
 */
export function analyserCollage(texte: string | null | undefined): string[] {
  return String(texte ?? "")
    .split(/[\r\n;,]+/)
    // L'espace avant le séparateur est toléré : « 3 - Sports » est aussi
    // courant que « 3. Sports » dans une liste recopiée à la main.
    .map((l) => normaliser(l.replace(/^\s*\d+\s*[.)\-–]\s*/, "")))
    .filter(Boolean);
}

/**
 * Comparaison de deux libellés pour l'affichage, en français.
 *
 * `localeCompare` et non l'ordre de la base : celui-ci dépend de la collation
 * du serveur, et range « Éducation » après « Zoo » là où une personne le
 * cherche entre « Education » et « Etat-Civil ».
 */
export const parNom = (a: string, b: string): number => a.localeCompare(b, "fr");

/**
 * Services proposés à la saisie, par ordre alphabétique.
 *
 * L'ordre de l'organigramme se défend sur un trombinoscope ; dans une liste
 * déroulante de trente-sept lignes, il oblige à tout parcourir pour trouver
 * « Sports » — personne ne connaît de tête le rang d'un service dans
 * l'organigramme, tout le monde sait épeler son nom.
 */
export async function servicesProposes(): Promise<string[]> {
  const lignes = await prisma.service.findMany({
    where: { actif: true },
    select: { nom: true },
  });
  return lignes.map((l) => l.nom).sort(parNom);
}

/**
 * Le libellé reçu correspond-il à un service du référentiel ?
 *
 * Renvoie le libellé **canonique** plutôt qu'un booléen : la comparaison est
 * souple, et c'est l'orthographe du référentiel qui doit être enregistrée. Sans
 * quoi le formulaire ne servirait à rien — « dsi » renvoyé par un client
 * bricolé recréerait la ligne parasite qu'on cherche à éviter.
 *
 * `null` quand rien ne correspond : au dépôt, la demande est refusée. Une liste
 * fermée côté écran ne vaut rien sans le contrôle côté serveur, la valeur d'un
 * `<select>` étant aussi falsifiable que celle d'un champ libre.
 */
export async function serviceDuReferentiel(saisi: string): Promise<string | null> {
  const cle = cleComparaison(saisi);
  if (!cle) return null;
  const noms = await servicesProposes();
  return noms.find((n) => cleComparaison(n) === cle) ?? null;
}

/**
 * Applique les regroupements à un libellé brut.
 *
 * Trois chances, de la plus explicite à la plus souple : une règle posée à la
 * main, un service du référentiel qui lui correspond à la graphie près, puis
 * un service dont le nom ouvre le libellé — « Jeunesse — Kid Club » retombe sur
 * « Jeunesse ». Sans règle ni correspondance, le libellé brut est conservé : ne
 * rien reconnaître ne doit jamais effacer ce que dit l'annuaire.
 */
export function resoudreService(
  brut: string | null | undefined,
  regles: Map<string, string>,
  referentiel: string[],
): string | null {
  const source = normaliser(brut);
  if (!source) return null;

  const regle = regles.get(cleComparaison(source));
  if (regle) return regle;

  const cle = cleComparaison(source);
  const exact = referentiel.find((n) => cleComparaison(n) === cle);
  if (exact) return exact;

  // Le service du référentiel dont le nom ouvre le libellé, le plus long
  // d'abord : « Petite Enfance — Crèche » doit gagner sur « Petite ».
  const prefixes = referentiel
    .filter((n) => cle.startsWith(`${cleComparaison(n)} `))
    .sort((a, b) => cleComparaison(b).length - cleComparaison(a).length);
  return prefixes[0] ?? source;
}

/** Règles en vigueur, indexées par clé de comparaison de leur source. */
export async function reglesDeRegroupement(): Promise<Map<string, string>> {
  const lignes = await prisma.regroupementService.findMany({
    select: { source: true, cible: true },
  });
  return new Map(lignes.map((l) => [cleComparaison(l.source), l.cible]));
}

/**
 * Recalcule `User.service` à partir du libellé brut et des règles en vigueur.
 *
 * Les comptes dont le rattachement a été forcé sont laissés tels quels : leur
 * service résulte d'une décision humaine, pas d'une règle, et une règle ne doit
 * pas la défaire pendant la nuit.
 *
 * Le libellé brut vient du miroir de l'annuaire pour un compte AD, et du champ
 * lui-même pour les autres — un participant hors annuaire n'a pas d'autre
 * source, et son service a été choisi dans le référentiel au moment de valider
 * sa demande.
 */
export async function appliquerRegroupements(): Promise<number> {
  const [regles, referentiel, comptes, miroir] = await Promise.all([
    reglesDeRegroupement(),
    servicesProposes(),
    prisma.user.findMany({
      where: { serviceForce: false },
      select: { id: true, login: true, service: true },
    }),
    prisma.adAccount.findMany({ select: { samAccountName: true, service: true } }),
  ]);

  const brutParLogin = new Map(
    miroir.map((m) => [m.samAccountName.toLowerCase(), m.service]),
  );

  let touches = 0;
  for (const u of comptes) {
    const brut = brutParLogin.get(u.login.toLowerCase()) ?? u.service;
    const cible = resoudreService(brut, regles, referentiel);
    if (cible !== u.service) {
      await prisma.user.update({ where: { id: u.id }, data: { service: cible } });
      touches++;
    }
  }
  return touches;
}

/**
 * Le service affiché pour un libellé brut, règles et référentiel lus en base.
 *
 * Pour les chemins qui créent ou rattachent UN compte depuis l'annuaire —
 * connexion, lien magique, inscription d'un agent encore inconnu, rattachement
 * d'un participant à son compte AD. Recopier le libellé tel quel y laissait
 * une valeur que la synchronisation ne corrigeait que la nuit suivante, et
 * l'écran disait entre-temps autre chose que le référentiel.
 */
export async function serviceResolu(brut: string | null | undefined): Promise<string | null> {
  const [regles, referentiel] = await Promise.all([reglesDeRegroupement(), servicesProposes()]);
  return resoudreService(brut, regles, referentiel);
}
