import { prisma } from "./db";

/**
 * Recherche dans les comptes Bolt.
 *
 * Volontairement hors des fichiers « use server » : tout export d'un module
 * d'actions devient un point d'entrée appelable depuis le navigateur, et ce
 * helper ne porte aucun contrôle d'accès. Ce sont les actions qui l'appellent
 * qui vérifient les droits — session gestionnaire, ou jeton d'animateur avec
 * PIN validé.
 */
export type Candidat = {
  login: string; // sAMAccountName — identifiant pivot
  nom: string;
  email: string | null;
  service: string | null;
  direction: string | null;
  source: "compte" | "annuaire";
};

/**
 * Préfixe des participants créés hors annuaire. Il ne peut jamais entrer en
 * collision avec un sAMAccountName, ce qui permet de reconnaître ces comptes
 * à leur seul identifiant — et de les rattacher plus tard à un vrai compte AD.
 */
export const PREFIXE_HORS_ANNUAIRE = "no_ad.";

/**
 * Préfixe utilisé avant le passage à « no_ad. ».
 *
 * Le changement n'avait porté que sur le code : les participants créés avant
 * gardaient leur identifiant « ext.… » et étaient donc classés parmi les comptes
 * d'annuaire. Conséquence concrète : la synchronisation les voyait absents de
 * l'AD et se serait apprêtée à les désactiver. La migration
 * `20260730170000_prefixe_hors_annuaire` renomme ces lignes ; ce préfixe reste
 * reconnu au cas où l'une d'elles n'aurait pas pu l'être.
 */
export const PREFIXE_HORS_ANNUAIRE_ANCIEN = "ext.";

/**
 * Vrai pour un participant créé à la main, absent de l'Active Directory.
 *
 * Volontairement STRICT : sert de liste blanche là où la réponse ouvre un droit
 * — notamment la saisie de l'adresse de contact, qui commande l'envoi du lien de
 * connexion (voir `modifierEmailAgent`). Un compte d'annuaire réellement nommé
 * « ext.qqch » ne doit pas y entrer par accident.
 */
export function estHorsAnnuaire(login: string): boolean {
  return login.toLowerCase().startsWith(PREFIXE_HORS_ANNUAIRE);
}

/**
 * Vrai pour un participant créé à la main, ancien préfixe compris.
 *
 * Volontairement PERMISSIF, à l'inverse de `estHorsAnnuaire` : sert à classer et
 * à protéger, jamais à accorder un droit. Se tromper dans ce sens fait qu'un
 * compte n'est pas désactivé automatiquement — un ménage manqué. Se tromper dans
 * l'autre effacerait les activités de quelqu'un qui n'est pas parti.
 */
export function estCreeALaMain(login: string): boolean {
  const l = login.toLowerCase();
  return (
    l.startsWith(PREFIXE_HORS_ANNUAIRE) || l.startsWith(PREFIXE_HORS_ANNUAIRE_ANCIEN)
  );
}

/**
 * Adresse à laquelle écrire à un agent.
 *
 * L'adresse de contact, saisie par le service des sports, l'emporte sur celle
 * de l'annuaire : c'est tout l'intérêt de la saisir. Un agent de terrain a bien
 * une boîte professionnelle sur le papier, mais ne la consulte jamais — lui
 * envoyer un lien de connexion valable trente minutes revient à ne rien
 * envoyer.
 */
export function adresseDeContact(user: {
  email: string | null;
  emailContact: string | null;
}): string | null {
  return user.emailContact?.trim() || user.email?.trim() || null;
}

/**
 * Identifiant unique pour un participant hors annuaire, dérivé de son nom.
 * Le suffixe numérique traite les homonymes, fréquents à l'échelle d'une
 * collectivité.
 */
async function identifiantLibre(nom: string): Promise<string> {
  const slug = nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents décomposés par la normalisation
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 28);
  // Un nom entièrement composé de ponctuation ne doit pas produire « no_ad. ».
  const base = slug
    ? `${PREFIXE_HORS_ANNUAIRE}${slug}`
    : `${PREFIXE_HORS_ANNUAIRE}participant`;

  for (let n = 0; n < 100; n++) {
    const candidat = n === 0 ? base : `${base}.${n + 1}`;
    const pris = await prisma.user.findUnique({
      where: { login: candidat },
      select: { id: true },
    });
    if (!pris) return candidat;
  }
  // Repli improbable : 100 homonymes exacts.
  return `${base}.${Date.now().toString(36)}`;
}

/**
 * Crée un participant absent de l'Active Directory : élu, agent d'un autre
 * organisme, stagiaire en attente de compte. Le compte n'a pas de mot de passe
 * — la connexion, si elle est utile, passe par le lien envoyé sur l'adresse
 * renseignée. Comme `chercherComptes`, ce helper ne porte aucun contrôle
 * d'accès : il incombe aux actions appelantes.
 */
export async function creerParticipantHorsAnnuaire(donnees: {
  nom: string;
  email?: string | null;
  direction?: string | null;
  service?: string | null;
}) {
  return prisma.user.create({
    data: {
      login: await identifiantLibre(donnees.nom),
      displayName: donnees.nom,
      email: donnees.email || null,
      direction: donnees.direction || null,
      service: donnees.service || null,
      role: "AGENT",
      isLocal: false, // aucun mot de passe : ni AD, ni compte local
    },
  });
}

/**
 * Candidat tel qu'il peut sortir sur Internet.
 *
 * Le nom, et de quoi lever un homonyme — rien d'autre. Ni l'adresse
 * professionnelle, ni le sAMAccountName : la feuille d'émargement est jointe
 * depuis Internet, et un identifiant de domaine y serait le premier
 * renseignement utile à qui s'attaque au webmail ou au VPN par ailleurs. La
 * référence transmise au serveur est l'identifiant interne, qui n'apprend rien.
 */
export type CandidatFeuille = {
  id: string;
  nom: string;
  situation: string | null; // service, à défaut direction
};

/**
 * Recherche destinée à la feuille d'émargement publique.
 *
 * Porte sur le seul nom affiché : chercher aussi par identifiant ou par adresse
 * — ce que fait `chercherComptes` pour le back-office — permettrait de
 * CONFIRMER depuis Internet un identifiant ou une adresse devinés. L'animateur,
 * lui, connaît le nom de la personne qui est devant lui.
 */
export async function chercherComptesFeuille(
  query: string,
  exclus: string[] = [],
): Promise<CandidatFeuille[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const comptes = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["AGENT", "GESTIONNAIRE", "COACH"] },
      ...(exclus.length > 0 ? { id: { notIn: exclus } } : {}),
      displayName: { contains: q, mode: "insensitive" },
    },
    select: { id: true, displayName: true, service: true, direction: true },
    orderBy: { displayName: "asc" },
    take: 10,
  });
  return comptes.map((u) => ({
    id: u.id,
    nom: u.displayName,
    situation: u.service ?? u.direction,
  }));
}

export async function chercherComptes(
  query: string,
  exclus: string[] = [],
): Promise<Candidat[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const comptes = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["AGENT", "GESTIONNAIRE", "COACH"] },
      ...(exclus.length > 0 ? { id: { notIn: exclus } } : {}),
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { login: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { displayName: "asc" },
    take: 10,
  });
  return comptes.map((u) => ({
    login: u.login.toLowerCase(),
    nom: u.displayName,
    email: u.email,
    service: u.service,
    direction: u.direction,
    source: "compte" as const,
  }));
}

/**
 * Directions et services tels qu'ils existent dans l'annuaire.
 *
 * Servent de suggestions là où un rattachement se saisit à la main — validation
 * d'une demande d'accès, création d'un participant hors annuaire. Sans elles,
 * chacun écrit « Dsi », « DSI » ou « Direction des systèmes d'information », et
 * la fréquentation par direction se répartit sur trois lignes qui désignent le
 * même service. Le champ reste libre : un vacataire peut relever d'un organisme
 * qui n'existe dans aucun annuaire.
 */
export async function rattachementsConnus(): Promise<{
  directions: string[];
  services: string[];
}> {
  const [directions, services] = await Promise.all([
    prisma.adAccount.findMany({
      where: { direction: { not: null }, enabled: true },
      select: { direction: true },
      distinct: ["direction"],
      orderBy: { direction: "asc" },
    }),
    prisma.adAccount.findMany({
      where: { service: { not: null }, enabled: true },
      select: { service: true },
      distinct: ["service"],
      orderBy: { service: "asc" },
    }),
  ]);
  return {
    directions: directions.map((d) => d.direction!).filter(Boolean),
    services: services.map((s) => s.service!).filter(Boolean),
  };
}

/**
 * Ce qu'on affiche à la place de l'identifiant, dans les listes et les fiches.
 *
 * Le sAMAccountName d'un compte d'annuaire sert : c'est ainsi que le service des
 * sports et la DSI désignent une personne. Celui d'un compte créé à la main —
 * « no_ad.parfait.chloe » — n'est qu'un détail d'implémentation.
 *
 * Il est remplacé par « adresse perso », qui dit la seule chose utile à cet
 * endroit : cette personne n'a pas de compte de domaine, et l'adresse affichée
 * à côté est la sienne, pas celle de l'annuaire. Sans cette mention, on
 * s'étonne de voir une adresse Gmail dans une liste d'agents.
 */
export function mentionCompte(login: string): string {
  return estCreeALaMain(login) ? "adresse perso" : login;
}
