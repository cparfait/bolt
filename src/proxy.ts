import { NextResponse, type NextRequest } from "next/server";
import { cidrsInternes, clientIp, inCidr } from "@/lib/net";

/**
 * Cloisonnement réseau — ceinture et bretelles du reverse proxy.
 *
 * Les animateurs ne sont pas sur le réseau de la collectivité : la feuille
 * d'émargement doit être joignable depuis Internet. Tout le reste (back-office,
 * page de connexion Active Directory, API) n'a aucune raison de l'être.
 *
 * Quand INTERNAL_CIDRS est renseigné, une requête venue d'une adresse hors de
 * ces plages ne peut atteindre que les chemins publics ci-dessous. Sans cette
 * variable, aucun filtrage n'est appliqué (déploiement strictement interne, ou
 * filtrage déjà assuré par le proxy).
 *
 * L'adresse cliente est lue dans X-Forwarded-For : le reverse proxy DOIT la
 * renseigner et écraser toute valeur fournie par le client.
 *
 * PORTÉE : ce filtrage porte sur les CHEMINS. Il ne cloisonne donc pas les
 * actions serveur, qui ne sont pas liées au chemin qui les affiche — un POST sur
 * `/emargement/<jeton>` peut désigner n'importe quelle action de l'application.
 * Les actions sensibles vérifient elles-mêmes l'origine réseau, via
 * `estInterne` (src/lib/net.ts) ; voir le commentaire qui y détaille le
 * mécanisme.
 *
 * Convention Next 16 : ce fichier s'appelle `proxy.ts` et exporte `proxy`
 * (l'ancien nom `middleware` est déprécié).
 */

// Chemins accessibles depuis l'extérieur : la feuille d'émargement des
// animateurs, et rien d'autre par défaut.
// `/icones` porte les icônes d'installation : sans elles, le téléphone d'un
// animateur hors réseau ne peut pas poser l'application sur son écran d'accueil.
const PUBLIC_PREFIXES = [
  "/emargement",
  "/icones",
  "/_next",
  "/favicon.ico",
  "/api/health",
];

// PUBLIC_AGENT_ACCESS=1 ouvre en plus l'espace agent aux connexions par lien
// e-mail, pour les agents sans poste sur le réseau (terrain, crèches).
// La page de connexion Active Directory (/connexion), elle, n'est JAMAIS
// publiée : aucun identifiant de domaine ne doit être saisissable depuis
// Internet.
const PUBLIC_AGENT_PREFIXES = ["/acces", "/mes-activites"];

function isPublicPath(pathname: string): boolean {
  const prefixes =
    process.env.PUBLIC_AGENT_ACCESS === "1"
      ? [...PUBLIC_PREFIXES, ...PUBLIC_AGENT_PREFIXES]
      : PUBLIC_PREFIXES;
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function refus(message: string): NextResponse {
  return new NextResponse(message, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export function proxy(request: NextRequest) {
  const cidrs = cidrsInternes();

  // Pas de plage déclarée → pas de cloisonnement (déploiement interne simple).
  if (cidrs.length === 0) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const ip = clientIp(request.headers);

  // Aucun en-tête de proxy : la requête n'est pas passée par le reverse proxy.
  // En développement (accès direct à localhost), on laisse passer. En
  // production, on refuse : mieux vaut un back-office inaccessible — le
  // symptôme est immédiat et l'émargement continue de fonctionner — qu'un
  // back-office ouvert parce que le proxy oublie X-Forwarded-For.
  if (ip === "") {
    return process.env.NODE_ENV === "production"
      ? refus(
          "Configuration incomplète : le reverse proxy doit transmettre l'en-tête X-Forwarded-For.",
        )
      : NextResponse.next();
  }

  // IPv6 ou adresse illisible : on ne devine pas, on refuse (fail-closed).
  if (cidrs.some((c) => inCidr(ip, c))) return NextResponse.next();

  return refus(
    "Cette partie de Bolt n'est accessible que depuis le réseau de la collectivité ou via le VPN.",
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
