import { cookies, headers } from "next/headers";
import { getIronSession, type IronSession } from "iron-session";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { clientIp, estInterne } from "./net";
import { audit } from "./audit";
import type { Role, User } from "@prisma/client";

export type SessionData = {
  userId?: string;
  // Session d'un animateur connecté par lien : le PIN a été validé pour ce coach.
  coachId?: string;
  coachPinAt?: number; // horodatage de la validation du PIN
};

const DEV_SESSION_SECRET = "bolt-dev-secret-a-changer-en-production-0123456789";

/**
 * Secret de chiffrement des cookies. En production, refuse de retomber sur le
 * secret de développement : un secret par défaut connu permettrait de forger
 * des sessions. Résolu à chaque requête plutôt qu'au chargement du module, pour
 * ne pas faire échouer `next build` quand la variable n'existe qu'au runtime.
 */
function resolveSessionPassword(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET absent ou trop court (32 caractères minimum) — " +
        "refus de démarrer en production avec le secret de développement par défaut.",
    );
  }
  return DEV_SESSION_SECRET;
}

const baseSessionOptions = {
  cookieName: "bolt_session",
  ttl: 12 * 60 * 60, // 12 heures
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === "1"
      : process.env.NODE_ENV === "production",
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const store = await cookies();
  return getIronSession<SessionData>(store, {
    password: resolveSessionPassword(),
    ...baseSessionOptions,
  });
}

export async function currentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session.userId) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.active) return null;
  return user;
}

/**
 * Compte connecté, pour l'ESPACE AGENT : ses activités, ses inscriptions, ses
 * absences. Ne contrôle pas l'origine réseau — c'est justement l'espace qui a
 * vocation à être joint depuis Internet.
 *
 * À n'employer que là où un agent agit sur ses propres données. Tout le reste
 * passe par `requireUser`, qui refuse l'extérieur.
 */
export async function requireAgent(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/connexion");
  return user;
}

/**
 * Compte connecté, pour le BACK-OFFICE. Redirige vers /connexion si personne
 * n'est connecté, et vérifie les rôles fournis (ADMIN passe toujours).
 *
 * Refuse aussi tout appel venu d'Internet, quel que soit le rôle — c'est le
 * point de passage unique qui rend vraie la décision « le back-office ne sort
 * pas du réseau ».
 *
 * Pourquoi ici et pas dans le middleware : celui-ci filtre des CHEMINS, or une
 * action serveur est adressée par un identifiant global et s'exécute même si la
 * requête est arrivée sur une autre page. Une session de gestionnaire ouverte
 * depuis Internet — un agent du service qui consulte ses propres activités de
 * chez lui — pourrait sinon appeler les actions de gestion depuis un chemin
 * publié.
 *
 * Pourquoi l'IP de la requête plutôt qu'une marque posée sur la session : une
 * session ouverte au bureau part avec l'ordinateur portable. C'est l'origine de
 * CETTE requête qui compte, pas celle du jour où l'on s'est connecté.
 *
 * Strict par défaut, et c'est délibéré : une action de gestion oubliée ici
 * refuse l'extérieur au lieu de l'accepter. Plusieurs — pointage, clôture,
 * annulation de séance — n'exigent aucun rôle et s'appuient sur
 * `seanceAutorisee` ; un contrôle branché sur l'argument `roles` les aurait
 * toutes manquées.
 */
export async function requireUser(...roles: Role[]): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/connexion");

  const ip = clientIp(await headers());
  if (!estInterne(ip)) {
    await audit("GESTION_HORS_RESEAU", { userId: user.id });
    redirect("/mes-activites");
  }

  if (roles.length > 0 && user.role !== "ADMIN" && !roles.includes(user.role)) {
    redirect("/");
  }
  return user;
}

/** Raccourci : le service des sports et la DSI gèrent le paramétrage métier. */
export const requireGestionnaire = () => requireUser("GESTIONNAIRE");

export function estGestionnaire(user: { role: Role }): boolean {
  return user.role === "ADMIN" || user.role === "GESTIONNAIRE";
}
