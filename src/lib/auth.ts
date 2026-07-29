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

/**
 * Authentifie sur le compte local s'il existe, sinon via LDAPS.
 * Les agents sont créés à la volée à leur première connexion.
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
