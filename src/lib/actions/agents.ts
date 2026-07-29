"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { chercherComptes, type Candidat } from "@/lib/comptes";
import { inscrireDirectement } from "@/lib/inscriptions";
import { requireUser } from "@/lib/session";
import { erreur, succes, type ActionState } from "./types";
import { getLdapSettings } from "@/lib/settings";
import { ldapSearchAccounts } from "@/lib/ldap";

/**
 * Recherche d'agents pour les inscriptions.
 *
 * Trois sources, par ordre de fiabilité décroissante :
 *  1. les comptes Bolt existants (l'agent s'est déjà connecté) ;
 *  2. le miroir de l'annuaire, alimenté par la synchronisation ;
 *  3. l'annuaire en direct, si un compte de service est configuré.
 *
 * Sans la 2 et la 3, la liste serait vide à la rentrée : personne ne s'est
 * encore connecté, et c'est précisément le moment où le service des sports
 * saisit les inscriptions.
 */

export type Suggestion = {
  id: string;
  nom: string;
  login: string;
  detail: string | null; // service, à défaut direction
  inscriptions: number;
};

/**
 * Suggestions de la barre de recherche du tableau de bord.
 *
 * Ne porte que sur les comptes Bolt, comme la page /agents vers laquelle elle
 * mène : on cherche ici quelqu'un dont on veut consulter les inscriptions et
 * l'assiduité, ce qui suppose qu'il en ait. Inscrire un agent inconnu passe par
 * la recherche annuaire de la page des inscriptions.
 */
export async function suggererAgents(query: string): Promise<Suggestion[]> {
  await requireUser("GESTIONNAIRE");
  const q = query.trim();
  if (q.length < 2) return [];

  const agents = await prisma.user.findMany({
    where: {
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { login: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { service: { contains: q, mode: "insensitive" } },
        { direction: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { displayName: "asc" },
    take: 8,
    select: {
      id: true,
      displayName: true,
      login: true,
      service: true,
      direction: true,
      _count: { select: { inscriptions: { where: { statut: "VALIDEE" } } } },
    },
  });

  return agents.map((a) => ({
    id: a.id,
    nom: a.displayName,
    login: a.login,
    detail: a.service ?? a.direction,
    inscriptions: a._count.inscriptions,
  }));
}

// Pas de ré-export du type `Candidat` ici : dans un module « use server », le
// transformeur des actions n'efface pas `export type { … }` et produit une
// référence à un symbole qui n'existe qu'à la compilation. Les consommateurs
// importent le type depuis @/lib/comptes, où il est défini.

export async function rechercherAgents(query: string): Promise<Candidat[]> {
  await requireUser("GESTIONNAIRE");
  const q = query.trim();
  if (q.length < 2) return [];

  const trouves = new Map<string, Candidat>();

  const comptes = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["AGENT", "GESTIONNAIRE", "COACH"] },
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { login: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { displayName: "asc" },
    take: 15,
  });
  for (const u of comptes) {
    trouves.set(u.login.toLowerCase(), {
      login: u.login.toLowerCase(),
      nom: u.displayName,
      email: u.email,
      service: u.service,
      direction: u.direction,
      source: "compte",
    });
  }

  const miroir = await prisma.adAccount.findMany({
    where: {
      enabled: true,
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { samAccountName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { displayName: "asc" },
    take: 15,
  });
  for (const a of miroir) {
    const cle = a.samAccountName.toLowerCase();
    if (trouves.has(cle)) continue;
    trouves.set(cle, {
      login: cle,
      nom: a.displayName ?? a.samAccountName,
      email: a.email,
      service: a.service,
      direction: a.direction,
      source: "annuaire",
    });
  }

  // Recherche à la volée : couvre les agents arrivés depuis la dernière
  // synchronisation. Best-effort — un annuaire injoignable ne doit pas casser
  // la recherche sur les deux premières sources.
  if (trouves.size < 10) {
    try {
      const ldap = await getLdapSettings();
      if (ldap?.bindDn && ldap?.bindPassword && ldap.enabled !== false) {
        for (const a of await ldapSearchAccounts(ldap, q, 10)) {
          const cle = a.samAccountName.toLowerCase();
          if (trouves.has(cle) || !a.enabled) continue;
          trouves.set(cle, {
            login: cle,
            nom: a.displayName ?? a.samAccountName,
            email: a.email ?? null,
            service: a.service ?? null,
            direction: a.direction ?? null,
            source: "annuaire",
          });
        }
      }
    } catch {
      // annuaire indisponible : on se contente des sources locales
    }
  }

  return [...trouves.values()]
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
    .slice(0, 20);
}

/**
 * Recherche restreinte aux agents déjà connus de Bolt — sans le miroir de
 * l'annuaire ni l'interrogation LDAP.
 *
 * Destinée aux animateurs, qui ajoutent un participant venu sans être inscrit.
 * Leur ouvrir l'annuaire entier reviendrait à exposer le répertoire de la
 * collectivité : un animateur est un intervenant extérieur, et la feuille
 * d'émargement est jointe depuis Internet. La contrepartie est assumée — un
 * agent qui n'a jamais été inscrit ni connecté n'apparaît pas, et c'est alors
 * au service des sports de l'ajouter.
 */
export async function rechercherAgentsConnus(query: string): Promise<Candidat[]> {
  await requireUser("GESTIONNAIRE", "COACH");
  return chercherComptes(query);
}

/**
 * Crée un participant qui n'existe pas dans l'Active Directory.
 *
 * Tout le monde n'a pas de compte AD : élus, agents d'un CCAS ou d'un syndicat
 * intercommunal, apprentis et stagiaires en attente d'ouverture de compte,
 * membres d'une association partenaire conviés aux séances. Sans cette porte,
 * ces participants n'existent nulle part — ni sur les feuilles, ni dans le
 * bilan de fréquentation, alors qu'ils occupent bien une place.
 *
 * L'identifiant est préfixé « ext. » : il ne peut donc jamais entrer en
 * collision avec un sAMAccountName si la personne obtient un compte AD plus
 * tard. Le compte n'a pas de mot de passe — la connexion, si elle est
 * nécessaire, passe par le lien envoyé sur l'adresse renseignée.
 *
 * La synchronisation de l'annuaire ne touche pas à ces comptes : elle ne
 * désactive jamais ce qu'elle n'y trouve pas.
 */
export async function creerAgentHorsAnnuaire(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("GESTIONNAIRE");
  const nom = String(formData.get("nom") ?? "").trim().replace(/\s+/g, " ");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const direction = String(formData.get("direction") ?? "").trim();
  const service = String(formData.get("service") ?? "").trim();
  const creneauId = String(formData.get("creneauId") ?? "");

  if (nom.length < 2) return erreur("Indiquez le nom et le prénom de la personne.");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return erreur("Adresse e-mail invalide.");
  }
  if (email) {
    const doublon = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { displayName: true },
    });
    if (doublon) {
      return erreur(
        `Cette adresse est déjà celle de ${doublon.displayName}. Cherchez-le plutôt dans la liste.`,
      );
    }
  }

  const user = await prisma.user.create({
    data: {
      login: await identifiantLibre(nom),
      displayName: nom,
      email: email || null,
      direction: direction || null,
      service: service || null,
      role: "AGENT",
      isLocal: false, // aucun mot de passe : ni AD, ni compte local
    },
  });

  let suite = "";
  if (creneauId) {
    const res = await inscrireDirectement(
      creneauId,
      user.id,
      admin.displayName,
      "Participant hors annuaire",
    );
    if (!res.deja) {
      suite =
        res.statut === "VALIDEE"
          ? " Inscrit au créneau."
          : ` Créneau complet : placé en liste d'attente (n°${res.rang}).`;
    }
  }

  await audit("AGENT_HORS_ANNUAIRE_CREE", {
    userId: admin.id,
    cible: nom,
    details: user.login,
  });
  revalidatePath("/inscriptions");
  revalidatePath("/agents");
  return succes(`${nom} créé (identifiant ${user.login}).${suite}`);
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
  // Un nom entièrement composé de ponctuation ne doit pas produire « ext. ».
  const base = slug ? `ext.${slug}` : "ext.participant";

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
 * Garantit l'existence du compte applicatif d'un agent, à partir de son
 * identifiant d'annuaire. Le compte créé ici n'a pas de mot de passe : l'agent
 * se connectera en LDAPS et récupérera ses inscriptions.
 */
export async function assurerCompteAgent(login: string): Promise<string | null> {
  const cle = login.trim().toLowerCase();
  if (!cle) return null;

  const existant = await prisma.user.findUnique({ where: { login: cle } });
  if (existant) return existant.id;

  let nom = cle;
  let email: string | null = null;
  let service: string | null = null;
  let direction: string | null = null;

  const miroir = await prisma.adAccount.findFirst({
    where: { samAccountName: { equals: cle, mode: "insensitive" } },
  });
  if (miroir) {
    nom = miroir.displayName ?? miroir.samAccountName;
    email = miroir.email;
    service = miroir.service;
    direction = miroir.direction;
  } else {
    try {
      const ldap = await getLdapSettings();
      if (ldap?.bindDn && ldap?.bindPassword) {
        const [trouve] = await ldapSearchAccounts(ldap, cle, 1);
        if (trouve) {
          nom = trouve.displayName ?? trouve.samAccountName;
          email = trouve.email ?? null;
          service = trouve.service ?? null;
          direction = trouve.direction ?? null;
          // On alimente le miroir au passage : la prochaine recherche sera locale.
          const { samAccountName, ...reste } = trouve;
          await prisma.adAccount.upsert({
            where: { samAccountName },
            update: { ...reste, syncedAt: new Date() },
            create: { samAccountName, ...reste, syncedAt: new Date() },
          });
        }
      }
    } catch {
      // on crée quand même le compte avec le seul identifiant
    }
  }

  const user = await prisma.user.create({
    data: { login: cle, displayName: nom, email, service, direction, role: "AGENT" },
  });
  return user.id;
}
