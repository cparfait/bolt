import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

// Bolt est publié derrière un reverse proxy TLS. La feuille d'émargement est
// la seule route joignable depuis Internet (voir src/middleware.ts) : les
// en-têtes ci-dessous verrouillent ce qu'un navigateur distant peut faire.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next injecte des scripts/styles inline (hydratation, Tailwind).
      // `unsafe-eval` n'est ajouté qu'en développement : React s'en sert pour
      // le rafraîchissement à chaud et la reconstruction des piles d'appel. Le
      // binaire de production n'y recourt jamais, et la directive disparaît
      // donc de l'application livrée.
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join("; "),
  },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Racine explicite : sans elle, Turbopack remonte jusqu'au premier
  // package-lock.json trouvé au-dessus du projet et se trompe de répertoire.
  turbopack: { root: import.meta.dirname },
  // Développement uniquement : autorise l'accès depuis un autre appareil du
  // réseau local — indispensable pour essayer la feuille d'émargement sur un
  // vrai téléphone (http://<ip-du-poste>:3000). Sans effet en production.
  allowedDevOrigins: ["10.*.*.*", "172.16.*.*", "192.168.*.*"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
