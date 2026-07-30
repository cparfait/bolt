/**
 * Utilitaires réseau partagés entre le proxy (src/proxy.ts) et le code serveur
 * qui journalise l'adresse de l'appelant.
 *
 * Isolés ici volontairement : le proxy s'exécute dans le runtime Edge, et
 * importer son module depuis une action serveur embarquerait `next/server`
 * sans nécessité.
 */

/** Convertit une IPv4 pointée en entier 32 bits. Renvoie null si invalide. */
export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const v = Number(part);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** Teste l'appartenance d'une IPv4 à un CIDR (« 10.0.0.0/8 ») ou à une IP exacte. */
export function inCidr(ip: string, cidr: string): boolean {
  const [network, bitsRaw] = cidr.split("/");
  const ipInt = ipv4ToInt(ip);
  const netInt = ipv4ToInt(network);
  if (ipInt === null || netInt === null) return false;
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

/** Normalise une adresse : retire le préfixe IPv6-mapped et le port éventuel. */
function normalizeIp(raw: string): string {
  let ip = raw.trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  const m = ip.match(/^(\d+\.\d+\.\d+\.\d+):\d+$/);
  return m ? m[1] : ip;
}

/**
 * Adresse du client, telle que transmise par le reverse proxy.
 * Chaîne vide si aucun en-tête de proxy n'est présent — l'appelant décide quoi
 * en faire, il n'y a pas de valeur par défaut sûre.
 */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return normalizeIp(fwd.split(",")[0]);
  return normalizeIp(headers.get("x-real-ip") ?? "");
}

/** Plages déclarées comme internes. Vide = aucun cloisonnement demandé. */
export function cidrsInternes(): string[] {
  return (process.env.INTERNAL_CIDRS ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * L'appelant est-il sur le réseau de la collectivité ?
 *
 * Même règle que le filtrage de chemins de `src/proxy.ts`, mais utilisable
 * depuis une action serveur. C'est nécessaire parce que le middleware filtre
 * des CHEMINS, alors qu'une action serveur n'est pas liée au chemin qui
 * l'affiche : elle est adressée par un identifiant global, et Next la fait
 * exécuter par le bundle qui la contient même si la requête est arrivée sur une
 * autre page (`selectWorkerForForwarding`). Un POST d'action sur
 * `/emargement/<jeton>` — le seul chemin publié sur Internet — désigne donc
 * n'importe quelle action de l'application, `loginAction` comprise.
 *
 * Le renvoi interne repasse aujourd'hui par le middleware et se fait refuser,
 * mais cette garantie tient à un détail d'implémentation non documenté. Les
 * actions qui n'ont rien à faire depuis Internet vérifient donc elles-mêmes.
 */
export function estInterne(ip: string): boolean {
  const cidrs = cidrsInternes();
  if (cidrs.length === 0) return true; // pas de plage déclarée → pas de filtrage
  // Aucun en-tête de proxy : accès direct au conteneur. Toléré en
  // développement, refusé en production — même arbitrage que le middleware.
  if (ip === "") return process.env.NODE_ENV !== "production";
  return cidrs.some((c) => inCidr(ip, c));
}
