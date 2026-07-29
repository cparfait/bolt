import { readFileSync } from "node:fs";
import { Client, type Entry } from "ldapts";
import type { LdapSettings } from "./settings";

// Matching rule AD « LDAP_MATCHING_RULE_IN_CHAIN » : appartenance de groupe
// récursive (groupes imbriqués inclus).
const MATCHING_RULE_IN_CHAIN = "1.2.840.113556.1.4.1941";

/**
 * Résout la cible ldapts (schéma + hôte + port) à partir de la config souple :
 * accepte un hôte simple ou une URL `ldap(s)://…`, un port explicite et une
 * bascule SSL. Ports par défaut 636 (LDAPS) / 389 (LDAP), et 389 laissé par
 * défaut est promu à 636 quand SSL est actif.
 */
function resolveUrl(cfg: LdapSettings): string {
  let raw = (cfg.url ?? "").trim();
  const low = raw.toLowerCase();
  let schemeSsl: boolean | null = null;
  if (low.startsWith("ldaps://")) {
    schemeSsl = true;
    raw = raw.slice(8);
  } else if (low.startsWith("ldap://")) {
    schemeSsl = false;
    raw = raw.slice(7);
  }
  raw = raw.replace(/\/+$/, "").trim();
  let host = raw;
  let portFromHost: number | undefined;
  const m = raw.match(/^(.*):(\d+)$/);
  if (m) {
    host = m[1];
    portFromHost = Number(m[2]);
  }
  const useSsl = Boolean(cfg.useSsl) || schemeSsl === true;
  let port = cfg.port || portFromHost || (useSsl ? 636 : 389);
  if (useSsl && port === 389) port = 636;
  return `${useSsl ? "ldaps" : "ldap"}://${host}:${port}`;
}

/** Charge le certificat CA : chemin de fichier PEM, sinon contenu PEM collé. */
function loadCa(caCert?: string): string | Buffer | undefined {
  const v = (caCert ?? "").trim();
  if (!v) return undefined;
  try {
    return readFileSync(v);
  } catch {
    return v; // pas un chemin lisible : on suppose que le PEM a été collé
  }
}

function buildClient(cfg: LdapSettings): Client {
  const url = resolveUrl(cfg);
  const tlsOptions = url.startsWith("ldaps://")
    ? { rejectUnauthorized: cfg.tlsRejectUnauthorized, ca: loadCa(cfg.caCert) }
    : undefined;
  return new Client({ url, timeout: 15000, connectTimeout: 10000, tlsOptions });
}

/** Échappe les caractères spéciaux dans un filtre LDAP (RFC 4515). */
function escapeFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => {
    switch (c) {
      case "\\":
        return "\\5c";
      case "*":
        return "\\2a";
      case "(":
        return "\\28";
      case ")":
        return "\\29";
      default:
        return "\\00";
    }
  });
}

function attr(entry: Entry, name: string): string | undefined {
  const v = entry[name];
  if (v === undefined) return undefined;
  const first = Array.isArray(v) ? v[0] : v;
  if (first === undefined) return undefined;
  return typeof first === "string" ? first : first.toString("utf8");
}

function attrAll(entry: Entry, name: string): string[] {
  const v = entry[name];
  if (v === undefined) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => (typeof x === "string" ? x : x.toString("utf8")));
}

/** Timestamp AD (FILETIME, 100 ns depuis 1601) → Date. */
function fileTimeToDate(ft: string | undefined): Date | null {
  if (!ft) return null;
  const n = Number(ft);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n / 10000 - 11644473600000);
}

/** « CN=Jean,OU=DSI,OU=Agents,DC=x » → « Agents / DSI ». */
function ouFromDn(dn: string): string {
  return dn
    .split(",")
    .filter((p) => p.trim().toUpperCase().startsWith("OU="))
    .map((p) => p.trim().slice(3))
    .reverse()
    .join(" / ");
}

export type LdapUserInfo = {
  displayName: string;
  email?: string;
  direction?: string;
  service?: string;
  gestionnaire: boolean; // membre du groupe « service des sports »
};

/**
 * Résout le DN d'un groupe AD. `group` peut déjà être un DN (contient « = ») ou
 * un nom simple (cn / sAMAccountName). Renvoie null si le groupe est introuvable.
 */
async function resolveGroupDn(
  client: Client,
  baseDn: string,
  group: string,
): Promise<string | null> {
  if (group.includes("=")) return group;
  const { searchEntries } = await client.search(baseDn, {
    scope: "sub",
    filter: `(&(objectClass=group)(|(cn=${escapeFilter(group)})(sAMAccountName=${escapeFilter(group)})))`,
    attributes: ["cn"],
    sizeLimit: 2,
  });
  return searchEntries[0]?.dn ?? null;
}

/**
 * Teste l'appartenance d'un utilisateur à un groupe AD, groupes imbriqués
 * inclus. Recherche via le compte de service si disponible, sinon via la
 * connexion de l'utilisateur. Renvoie false en cas d'échec (fail-closed).
 */
async function userInGroup(
  cfg: LdapSettings,
  login: string,
  group: string,
  userClient: Client,
): Promise<boolean> {
  let searchClient = userClient;
  let ownService: Client | null = null;
  if (cfg.bindDn && cfg.bindPassword) {
    ownService = buildClient(cfg);
    try {
      await ownService.bind(cfg.bindDn, cfg.bindPassword);
      searchClient = ownService;
    } catch {
      await ownService.unbind().catch(() => {});
      ownService = null;
    }
  }
  try {
    const groupDn = await resolveGroupDn(searchClient, cfg.baseDn, group);
    if (!groupDn) return false;
    const nested = await searchClient.search(cfg.baseDn, {
      scope: "sub",
      filter: `(&(sAMAccountName=${escapeFilter(login)})(memberOf:${MATCHING_RULE_IN_CHAIN}:=${escapeFilter(groupDn)}))`,
      attributes: ["cn"],
      sizeLimit: 2,
    });
    if (nested.searchEntries.length > 0) return true;
    // repli : appartenance directe via memberOf
    const { searchEntries } = await searchClient.search(cfg.baseDn, {
      scope: "sub",
      filter: `(sAMAccountName=${escapeFilter(login)})`,
      attributes: ["memberOf"],
      sizeLimit: 2,
    });
    const entry = searchEntries[0];
    if (entry) {
      const mof = attrAll(entry, "memberOf").map((x) => x.toLowerCase());
      return mof.includes(groupDn.toLowerCase());
    }
    return false;
  } catch {
    return false; // non vérifiable → accès refusé
  } finally {
    if (ownService) await ownService.unbind().catch(() => {});
  }
}

const USER_ATTRIBUTES = [
  "displayName",
  "mail",
  "sAMAccountName",
  "cn",
  "department", // service
  "division", // direction (ou « company » selon le paramétrage AD)
  "company",
];

/**
 * Authentifie un utilisateur en LDAPS. Identité de bind, par ordre de priorité :
 * 1. gabarit DN (`userDnTemplate`, jeton {username}) ;
 * 2. compte de service : recherche du DN puis bind avec le mot de passe fourni ;
 * 3. bind direct en UPN (login@suffixe) ou login brut.
 * Si un `requiredGroup` est configuré, seul un membre (imbriqué) peut se
 * connecter — vérification fail-closed.
 */
export async function ldapAuthenticate(
  cfg: LdapSettings,
  login: string,
  password: string,
): Promise<LdapUserInfo | null> {
  if (cfg.enabled === false) return null;
  if (!password) return null; // un bind anonyme réussirait sur certains annuaires
  const filter = `(&(objectClass=user)(sAMAccountName=${escapeFilter(login)}))`;

  let entry: Entry | undefined;
  let client: Client;

  if (cfg.userDnTemplate) {
    const dn = cfg.userDnTemplate.replace(/\{username\}/g, login);
    client = buildClient(cfg);
    try {
      await client.bind(dn, password);
    } catch {
      await client.unbind().catch(() => {});
      return null;
    }
  } else if (cfg.bindDn && cfg.bindPassword) {
    const service = buildClient(cfg);
    try {
      await service.bind(cfg.bindDn, cfg.bindPassword);
      const { searchEntries } = await service.search(cfg.baseDn, {
        scope: "sub",
        filter,
        attributes: USER_ATTRIBUTES,
        sizeLimit: 2,
      });
      entry = searchEntries[0];
    } finally {
      await service.unbind().catch(() => {});
    }
    if (!entry) return null;
    client = buildClient(cfg);
    try {
      await client.bind(entry.dn, password);
    } catch {
      await client.unbind().catch(() => {});
      return null;
    }
  } else {
    const upn = cfg.upnSuffix ? `${login}@${cfg.upnSuffix}` : login;
    client = buildClient(cfg);
    try {
      await client.bind(upn, password);
    } catch {
      await client.unbind().catch(() => {});
      return null;
    }
  }

  try {
    const group = (cfg.requiredGroup ?? "").trim();
    if (group) {
      if (!cfg.baseDn) return null; // sans base, non vérifiable → refusé
      if (!(await userInGroup(cfg, login, group, client))) return null;
    }

    if (!entry) {
      try {
        const { searchEntries } = await client.search(cfg.baseDn, {
          scope: "sub",
          filter,
          attributes: USER_ATTRIBUTES,
          sizeLimit: 2,
        });
        entry = searchEntries[0];
      } catch {
        // la lecture peut être refusée : on garde le login comme nom
      }
    }

    const gestionnaireGroup = (cfg.gestionnaireGroup ?? "").trim();
    const gestionnaire = gestionnaireGroup
      ? await userInGroup(cfg, login, gestionnaireGroup, client)
      : false;

    return {
      displayName: entry ? (attr(entry, "displayName") ?? attr(entry, "cn") ?? login) : login,
      email: entry ? attr(entry, "mail") : undefined,
      service: entry ? attr(entry, "department") : undefined,
      direction: entry ? (attr(entry, "division") ?? attr(entry, "company")) : undefined,
      gestionnaire,
    };
  } finally {
    await client.unbind().catch(() => {});
  }
}

/**
 * Filtre LDAP des comptes utilisateurs. Si un groupe est configuré, on restreint
 * aux membres (imbriqués). Lève une erreur si le groupe est introuvable, pour ne
 * pas vider la liste par mégarde.
 */
async function accountFilter(client: Client, cfg: LdapSettings): Promise<string> {
  const base = "(&(objectCategory=person)(objectClass=user))";
  const group = (cfg.requiredGroup ?? "").trim();
  if (!group) return base;
  const groupDn = await resolveGroupDn(client, cfg.baseDn, group);
  if (!groupDn) {
    throw new Error(
      `Groupe AD « ${group} » introuvable dans l'annuaire — synchronisation annulée pour éviter de vider la liste.`,
    );
  }
  return `(&(objectCategory=person)(objectClass=user)(memberOf:${MATCHING_RULE_IN_CHAIN}:=${escapeFilter(groupDn)}))`;
}

/** Teste la connexion avec le compte de service et compte les utilisateurs. */
export async function ldapTest(cfg: LdapSettings): Promise<{ ok: boolean; message: string }> {
  if (!cfg.bindDn || !cfg.bindPassword) {
    return {
      ok: false,
      message:
        "Renseignez un compte de service (DN + mot de passe) pour tester la connexion et synchroniser l'annuaire.",
    };
  }
  const client = buildClient(cfg);
  try {
    await client.bind(cfg.bindDn, cfg.bindPassword);
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: "sub",
      filter: await accountFilter(client, cfg),
      attributes: ["sAMAccountName"],
      paged: { pageSize: 500 },
    });
    return {
      ok: true,
      message: `Connexion ${resolveUrl(cfg).startsWith("ldaps") ? "LDAPS" : "LDAP"} réussie — ${searchEntries.length} comptes trouvés dans ${cfg.baseDn}.`,
    };
  } catch (e) {
    return { ok: false, message: `Échec : ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    await client.unbind().catch(() => {});
  }
}

export type AdEntry = {
  samAccountName: string;
  displayName?: string;
  email?: string;
  dn: string;
  ou: string;
  direction?: string;
  service?: string;
  enabled: boolean;
  lastLogon: Date | null;
};

const ACCOUNT_ATTRIBUTES = [
  "sAMAccountName",
  "displayName",
  "mail",
  "userAccountControl",
  "lastLogonTimestamp",
  "department",
  "division",
  "company",
];

function mapAccount(e: Entry): AdEntry {
  const uac = Number(attr(e, "userAccountControl") ?? "0");
  return {
    samAccountName: attr(e, "sAMAccountName")!,
    displayName: attr(e, "displayName"),
    email: attr(e, "mail"),
    dn: e.dn,
    ou: ouFromDn(e.dn),
    service: attr(e, "department"),
    direction: attr(e, "division") ?? attr(e, "company"),
    enabled: (uac & 2) === 0, // bit ACCOUNTDISABLE
    lastLogon: fileTimeToDate(attr(e, "lastLogonTimestamp")),
  };
}

/** Lit tous les comptes utilisateurs de l'AD (lecture seule). */
export async function ldapFetchAccounts(cfg: LdapSettings): Promise<AdEntry[]> {
  if (!cfg.bindDn || !cfg.bindPassword) {
    throw new Error("Compte de service LDAP non configuré.");
  }
  const client = buildClient(cfg);
  try {
    await client.bind(cfg.bindDn, cfg.bindPassword);
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: "sub",
      filter: await accountFilter(client, cfg),
      attributes: ACCOUNT_ATTRIBUTES,
      paged: { pageSize: 500 },
    });
    return searchEntries.filter((e) => attr(e, "sAMAccountName")).map(mapAccount);
  } finally {
    await client.unbind().catch(() => {});
  }
}

/** Lit un compte précis. Best-effort : ne doit jamais bloquer une connexion. */
export async function ldapFetchAccount(
  cfg: LdapSettings,
  login: string,
): Promise<AdEntry | null> {
  if (!cfg.bindDn || !cfg.bindPassword) return null;
  const client = buildClient(cfg);
  try {
    await client.bind(cfg.bindDn, cfg.bindPassword);
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: "sub",
      filter: `(&(objectCategory=person)(objectClass=user)(sAMAccountName=${escapeFilter(login)}))`,
      attributes: ACCOUNT_ATTRIBUTES,
      sizeLimit: 2,
    });
    const entry = searchEntries.find((e) => attr(e, "sAMAccountName"));
    return entry ? mapAccount(entry) : null;
  } catch {
    return null;
  } finally {
    await client.unbind().catch(() => {});
  }
}

export type AdGroup = { cn: string; dn: string };

/** Recherche des groupes AD par nom, pour l'autocomplétion des champs groupe. */
export async function ldapSearchGroups(
  cfg: LdapSettings,
  query: string,
  limit = 20,
): Promise<AdGroup[]> {
  if (!cfg.bindDn || !cfg.bindPassword) {
    throw new Error("Compte de service LDAP non configuré.");
  }
  const q = query.trim();
  const term = q ? `*${escapeFilter(q)}*` : "*";
  const client = buildClient(cfg);
  try {
    await client.bind(cfg.bindDn, cfg.bindPassword);
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: "sub",
      filter: `(&(objectClass=group)(|(cn=${term})(sAMAccountName=${term})))`,
      attributes: ["cn"],
      paged: { pageSize: Math.max(limit, 50) },
      sizeLimit: Math.max(limit, 50),
    });
    return searchEntries
      .map((e) => ({ cn: attr(e, "cn") ?? e.dn, dn: e.dn }))
      .sort((a, b) => a.cn.localeCompare(b.cn, "fr"))
      .slice(0, limit);
  } finally {
    await client.unbind().catch(() => {});
  }
}

/** Recherche « à la volée » de comptes AD, sans passer par la synchronisation. */
export async function ldapSearchAccounts(
  cfg: LdapSettings,
  query: string,
  limit = 10,
): Promise<AdEntry[]> {
  if (!cfg.bindDn || !cfg.bindPassword) {
    throw new Error("Compte de service LDAP non configuré.");
  }
  const q = escapeFilter(query.trim());
  if (!q) return [];
  const client = buildClient(cfg);
  try {
    await client.bind(cfg.bindDn, cfg.bindPassword);
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: "sub",
      filter: `(&(objectCategory=person)(objectClass=user)(|(displayName=*${q}*)(sAMAccountName=*${q}*)(mail=*${q}*)))`,
      attributes: ACCOUNT_ATTRIBUTES,
      paged: { pageSize: limit },
      sizeLimit: limit,
    });
    return searchEntries
      .filter((e) => attr(e, "sAMAccountName"))
      .slice(0, limit)
      .map(mapAccount);
  } finally {
    await client.unbind().catch(() => {});
  }
}
