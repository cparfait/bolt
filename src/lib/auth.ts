import bcrypt from "bcryptjs";
import type { Role, User } from "@prisma/client";
import { prisma } from "./db";
import { ldapAuthenticate, ldapFetchAccount } from "./ldap";
import { getLdapSettings } from "./settings";
import { audit } from "./audit";

/**
 * Crée le compte admin local de secours au premier démarrage, si aucun
 * administrateur actif n'existe.
 * Identifiant : admin — mot de passe : BOLT_ADMIN_PASSWORD.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const count = await prisma.user.count({ where: { role: "ADMIN", active: true } });
  if (count > 0) return;
  // En production, on exige un mot de passe explicite : un compte
  // « admin / bolt » par défaut ouvrirait un accès administrateur trivial.
  const password = process.env.BOLT_ADMIN_PASSWORD;
  if (process.env.NODE_ENV === "production" && (!password || password.length < 8)) {
    throw new Error(
      "BOLT_ADMIN_PASSWORD absent ou trop court (8 caractères minimum) — " +
        "définissez-le pour créer le compte administrateur de secours.",
    );
  }
  await prisma.user.upsert({
    where: { login: "admin" },
    update: { role: "ADMIN", active: true },
    create: {
      login: "admin",
      displayName: "Administrateur local",
      role: "ADMIN",
      isLocal: true,
      passwordHash: await bcrypt.hash(password || "bolt", 12),
    },
  });
}

/**
 * Détermine le rôle d'un compte AD à la connexion.
 *
 * Quand un groupe « service des sports » est configuré dans les paramètres, il
 * fait autorité : l'appartenance promeut GESTIONNAIRE, et la non-appartenance
 * rétrograde en AGENT. Les rôles ADMIN et COACH ne sont jamais touchés — ils
 * sont attribués dans Bolt, pas dans l'annuaire.
 */
function roleApresConnexion(
  actuel: Role,
  membreDuGroupe: boolean,
  groupeConfigure: boolean,
): Role {
  if (actuel === "ADMIN" || actuel === "COACH") return actuel;
  if (!groupeConfigure) return actuel;
  return membreDuGroupe ? "GESTIONNAIRE" : "AGENT";
}

/** Vrai si la saisie ressemble à une adresse plutôt qu'à un identifiant. */
export function estUneAdresse(saisie: string): boolean {
  return saisie.includes("@");
}

export type CompteConnu = {
  login: string;
  email: string | null;
  emailContact: string | null;
};

/**
 * Choisit le compte désigné par une adresse, parmi les correspondances trouvées.
 *
 * L'adresse d'annuaire l'emporte sur l'adresse de contact : la première est
 * unique par construction, la seconde est saisie à la main par le service des
 * sports et deux agents d'un même foyer peuvent y partager une boîte. À rang
 * égal, plusieurs correspondances ne se départagent pas — on refuse plutôt que
 * de connecter quelqu'un sur le compte d'un autre.
 */
export function loginDepuisAdresse(
  candidats: CompteConnu[],
  adresse: string,
): string | null {
  const cherchee = adresse.trim().toLowerCase();
  const correspond = (valeur: string | null) => valeur?.trim().toLowerCase() === cherchee;

  for (const champ of [
    (c: CompteConnu) => c.email,
    (c: CompteConnu) => c.emailContact,
  ]) {
    const trouves = candidats.filter((c) => correspond(champ(c)));
    if (trouves.length === 1) return trouves[0].login.toLowerCase();
    if (trouves.length > 1) return null; // ambiguïté : on ne devine pas
  }
  return null;
}

/**
 * Ramène ce qu'a saisi l'agent à un sAMAccountName.
 *
 * Les agents hésitent entre leur identifiant Windows et leur adresse
 * professionnelle — et beaucoup ne connaissent que la seconde. L'écran accepte
 * donc les deux, mais tout ce qui suit (bind LDAPS, appartenance aux groupes,
 * miroir d'annuaire) est indexé sur le sAMAccountName : la traduction se fait
 * ici, une fois, et le reste de la chaîne ne change pas.
 *
 * Deux sources, dans cet ordre : les comptes Bolt, puis le miroir de
 * l'annuaire — qui couvre l'agent qui ne s'est jamais connecté, à condition que
 * la synchronisation tourne. Adresse inconnue : on renvoie la saisie telle
 * quelle, et c'est l'authentification qui échouera, avec son message habituel.
 * Résoudre ici en un « adresse inconnue » ferait de cet écran un moyen de
 * vérifier qui travaille dans la collectivité.
 */
export async function resoudreIdentifiant(saisie: string): Promise<string> {
  const valeur = saisie.trim().toLowerCase();
  if (!estUneAdresse(valeur)) return valeur;

  const comptes = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { email: { equals: valeur, mode: "insensitive" } },
        { emailContact: { equals: valeur, mode: "insensitive" } },
      ],
    },
    select: { login: true, email: true, emailContact: true },
  });
  const parCompte = loginDepuisAdresse(comptes, valeur);
  if (parCompte) return parCompte;

  const ad = await prisma.adAccount.findMany({
    where: { enabled: true, email: { equals: valeur, mode: "insensitive" } },
    select: { samAccountName: true, email: true },
  });
  const parAnnuaire = loginDepuisAdresse(
    ad.map((a) => ({ login: a.samAccountName, email: a.email, emailContact: null })),
    valeur,
  );
  return parAnnuaire ?? valeur;
}

/**
 * Authentifie sur le compte local s'il existe, sinon via LDAPS.
 * Les agents sont créés à la volée à leur première connexion.
 *
 * `rawLogin` est un sAMAccountName : la saisie de l'agent, qui peut être une
 * adresse, est traduite en amont par `resoudreIdentifiant`.
 */
export async function authenticate(
  rawLogin: string,
  password: string,
): Promise<User | null> {
  const login = rawLogin.trim().toLowerCase();
  if (!login || !password) return null;

  const existing = await prisma.user.findUnique({ where: { login } });

  // Comptes locaux : administrateur de secours et animateurs en accès « LOCAL ».
  if (existing?.isLocal) {
    if (!existing.active || !existing.passwordHash) return null;
    const ok = await bcrypt.compare(password, existing.passwordHash);
    if (!ok) {
      await audit("CONNEXION_ECHEC", { cible: login, details: "mot de passe local" });
      return null;
    }
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { lastLoginAt: new Date() },
    });
    await audit("CONNEXION", { userId: user.id });
    return user;
  }

  const ldap = await getLdapSettings();
  if (!ldap?.url || !ldap?.baseDn || ldap.enabled === false) {
    await audit("CONNEXION_ECHEC", {
      cible: login,
      details: ldap?.enabled === false ? "LDAP désactivé" : "LDAP non configuré",
    });
    return null;
  }

  const info = await ldapAuthenticate(ldap, login, password);
  if (!info) {
    await audit("CONNEXION_ECHEC", { cible: login, details: "LDAPS" });
    return null;
  }

  // Rafraîchit le miroir annuaire pour cet agent. Best-effort : n'interrompt
  // jamais la connexion si l'AD est momentanément indisponible en lecture.
  try {
    const ad = await ldapFetchAccount(ldap, login);
    if (ad) {
      const { samAccountName, ...rest } = ad;
      await prisma.adAccount.upsert({
        where: { samAccountName },
        update: { ...rest, syncedAt: new Date() },
        create: { samAccountName, ...rest, syncedAt: new Date() },
      });
    }
  } catch {
    // le miroir annuaire n'est pas critique pour l'authentification
  }

  const groupeConfigure = Boolean((ldap.gestionnaireGroup ?? "").trim());

  if (existing) {
    if (!existing.active) return null;
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        displayName: info.displayName,
        email: info.email ?? existing.email,
        direction: info.direction ?? existing.direction,
        service: info.service ?? existing.service,
        role: roleApresConnexion(existing.role, info.gestionnaire, groupeConfigure),
        lastLoginAt: new Date(),
      },
    });
    await audit("CONNEXION", { userId: user.id });
    return user;
  }

  const user = await prisma.user.create({
    data: {
      login,
      displayName: info.displayName,
      email: info.email,
      direction: info.direction,
      service: info.service,
      role: info.gestionnaire ? "GESTIONNAIRE" : "AGENT",
      isLocal: false,
      lastLoginAt: new Date(),
    },
  });
  await audit("CONNEXION_PREMIERE", { userId: user.id, cible: login });
  return user;
}
