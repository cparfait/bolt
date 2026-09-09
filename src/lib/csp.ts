/**
 * Politique de sécurité du contenu, avec un nonce par requête.
 *
 * Posée depuis le proxy (src/proxy.ts) et non dans `next.config.ts` : un
 * en-tête statique ne peut porter qu'un `'unsafe-inline'`, qui autorise tout
 * script inline — le nôtre comme celui qu'une injection glisserait. La
 * politique ne protégeait alors de rien. Avec un nonce tiré à chaque requête,
 * seuls les scripts qui le portent s'exécutent, et Next le pose lui-même sur
 * les siens dès qu'il le trouve dans l'en-tête `Content-Security-Policy` de
 * la requête entrante.
 *
 * `'strict-dynamic'` : les scripts chargés par un script de confiance le sont
 * aussi — c'est ainsi que Next charge ses morceaux. Les navigateurs qui le
 * comprennent ignorent alors `'self'`, gardé pour les autres.
 *
 * Les styles restent en `'unsafe-inline'` : Tailwind et React en posent, et un
 * style injecté ne fait pas exécuter de code.
 *
 * Isolé ici, sans dépendance à `next/server`, pour rester testable en fonction
 * pure et importable depuis le runtime Edge.
 */

export function nonceAleatoire(): string {
  const octets = new Uint8Array(16);
  crypto.getRandomValues(octets);
  let s = "";
  for (const o of octets) s += String.fromCharCode(o);
  return btoa(s);
}

export function politiqueCsp(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    // `unsafe-eval` n'est ajouté qu'en développement : le rafraîchissement à
    // chaud et la reconstruction des piles d'appel s'en servent, le binaire de
    // production jamais.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}
