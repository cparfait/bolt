import type { NextConfig } from "next";

// Bolt est publié derrière un reverse proxy TLS. La feuille d'émargement est
// la seule route joignable depuis Internet (voir src/proxy.ts) : les en-têtes
// ci-dessous verrouillent ce qu'un navigateur distant peut faire.
//
// La Content-Security-Policy n'est plus ici : elle porte un nonce par requête
// et se pose donc depuis le proxy (src/proxy.ts, src/lib/csp.ts).
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // L'application n'utilise pas `next/image` : ses seules images sont des data
  // URI. Sans cette ligne, la route `/_next/image` reste servie, joignable sans
  // session, et décode des fichiers avec des bibliothèques natives — c'est par
  // elle que passait la faille GHSA-2xp9-vwfh-vxw4. Une route qui ne sert à
  // rien n'a pas à exister.
  images: { unoptimized: true },
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
