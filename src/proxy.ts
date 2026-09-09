import { NextResponse, type NextRequest } from "next/server";
import { cidrsInternes, clientIp, inCidr } from "@/lib/net";
import { nonceAleatoire, politiqueCsp } from "@/lib/csp";

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
// `/courriel` porte les pages à un seul bouton ouvertes depuis un message —
// « je ne pourrai pas venir », « je laisse ma place ». Elles sont ici pour la
// même raison que l'émargement : ces courriels se lisent sur un téléphone, hors
// du réseau, par les agents qui n'ont justement pas de poste au bureau. Elles
// n'ouvrent aucune session et ne servent rien sans une signature valable pour
// cet agent et cet objet précis (src/lib/liens-courriel.ts) ; sans elle, un 404.
const PUBLIC_PREFIXES = [
  "/emargement",
  "/courriel",
  "/icones",
  // `/_next/static` seulement, pas `/_next` : le reste de ce préfixe
  // (optimiseur d'images, outils de développement) n'a rien à faire dehors.
  "/_next/static",
  "/favicon.ico",
  // Servi depuis public/ : le proxy le relaie plutôt que de répondre 403 à une
  // requête que tout robot légitime émet en arrivant.
  "/robots.txt",
  "/api/health",
];

// PUBLIC_AGENT_ACCESS=1 ouvre en plus l'espace agent aux connexions par lien
// e-mail, pour les agents sans poste sur le réseau (terrain, crèches).
// La page de connexion Active Directory (/connexion), elle, n'est JAMAIS
// publiée : aucun identifiant de domaine ne doit être saisissable depuis
// Internet.
//
// `/mentions` en fait partie sans être un écran d'accès : c'est le lien que
// porte le pied de page de l'espace agent. Absent d'ici, un agent connecté
// depuis Internet qui clique sur « Mentions d'information » obtient un 403 —
// soit exactement l'information qu'on lui promet accessible à tout moment.
//
// `/demande-acces` est le seul chemin de l'application qui accepte une identité
// inconnue. Il ne délivre rien : ni compte, ni session, ni courriel vers
// l'adresse saisie (voir src/lib/demandes.ts). Le back-office qui arbitre ces
// demandes, `/agents/demandes`, reste sous `/agents` — donc injoignable
// d'Internet.
const PUBLIC_AGENT_PREFIXES = [
  "/acces",
  "/mes-activites",
  "/mentions",
  "/demande-acces",
];

function isPublicPath(pathname: string): boolean {
  const prefixes =
    process.env.PUBLIC_AGENT_ACCESS === "1"
      ? [...PUBLIC_PREFIXES, ...PUBLIC_AGENT_PREFIXES]
      : PUBLIC_PREFIXES;
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Réponse à une requête venue d'Internet sur un chemin qui n'y est pas publié.
 *
 * Par défaut, une redirection vers PUBLIC_REDIRECT_URL — le site de la
 * collectivité. Un message expliquant qu'il faut être sur le réseau interne
 * renseigne le visiteur sur ce qui existe derrière : qu'il y a une application,
 * qu'elle a une partie réservée, et qu'il suffirait d'être « à l'intérieur ».
 * C'est peu, mais c'est gratuit à ne pas donner — et c'est déjà le parti pris du
 * vhost fourre-tout d'Apache, qui renvoie tout nom inconnu vers le site de la
 * ville plutôt que d'afficher une erreur.
 *
 * 303 et non 307 : un POST refusé doit devenir un GET vers le site public, pas
 * y être rejoué.
 *
 * Sans la variable, on retombe sur le message explicite — utile en interne, où
 * la personne qui le lit est justement celle qui peut agir.
 */
function refus(message: string): NextResponse {
  const cible = process.env.PUBLIC_REDIRECT_URL?.trim();
  if (cible) {
    try {
      return NextResponse.redirect(new URL(cible), 303);
    } catch {
      // URL invalide : on ne redirige pas vers n'importe quoi, on refuse.
    }
  }
  return new NextResponse(message, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Laisse passer la requête, avec une Content-Security-Policy à nonce.
 *
 * L'en-tête est posé sur la requête ENTRANTE — c'est là que Next va le lire
 * pour marquer ses propres scripts du nonce — et recopié sur la réponse, où le
 * navigateur l'applique. Voir src/lib/csp.ts.
 */
function passer(request: NextRequest): NextResponse {
  const nonce = nonceAleatoire();
  const csp = politiqueCsp(nonce, process.env.NODE_ENV !== "production");
  const entrants = new Headers(request.headers);
  entrants.set("content-security-policy", csp);
  entrants.set("x-nonce", nonce);
  const reponse = NextResponse.next({ request: { headers: entrants } });
  reponse.headers.set("content-security-policy", csp);
  return reponse;
}

export function proxy(request: NextRequest) {
  const cidrs = cidrsInternes();

  // Pas de plage déclarée → pas de cloisonnement (déploiement interne simple).
  if (cidrs.length === 0) return passer(request);

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return passer(request);

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
      : passer(request);
  }

  // IPv6 ou adresse illisible : on ne devine pas, on refuse (fail-closed).
  if (cidrs.some((c) => inCidr(ip, c))) return passer(request);

  return refus(
    "Cette partie de l'application n'est accessible que depuis le réseau de la collectivité ou via le VPN.",
  );
}

export const config = {
  matcher: ["/((?!_next/static).*)"],
};
