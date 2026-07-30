"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { authenticate, ensureBootstrapAdmin } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { clientIp, estInterne } from "@/lib/net";
import { envoyerLienConnexion } from "@/lib/magic";
import { getGeneralSettings } from "@/lib/settings";
import type { ActionState } from "./types";

export type LoginState = { error?: string } | null;

/**
 * Ces deux actions n'ont rien à faire depuis Internet, et le filtrage de chemins
 * du middleware ne les couvre pas : une action serveur s'appelle par son
 * identifiant, depuis n'importe quel chemin publié (voir `estInterne`).
 *
 * Sans cette vérification, un identifiant de domaine serait testable de
 * l'extérieur via la feuille d'émargement. Le risque n'est pas de deviner un mot
 * de passe — la limitation de débit y veille — mais de FAIRE VERROUILLER des
 * comptes Active Directory en série : dix essais suffisent à franchir un seuil
 * de lockout réglé à trois ou cinq.
 */
const HORS_RESEAU =
  "Cette page n'est accessible que depuis le réseau de la collectivité ou via le VPN.";

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const login = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!login || !password) {
    return { error: "Renseignez votre identifiant et votre mot de passe." };
  }

  const ip = clientIp(await headers());
  if (!estInterne(ip)) {
    await audit("CONNEXION_HORS_RESEAU", { cible: login });
    return { error: HORS_RESEAU };
  }

  // Anti-bruteforce : par identifiant ET par adresse, pour couvrir aussi bien
  // l'acharnement sur un compte que le balayage de plusieurs comptes.
  for (const cle of [`login:${login.toLowerCase()}`, `ip:${ip}`]) {
    const rl = rateLimit(cle, 10, 300);
    if (!rl.ok) {
      await audit("CONNEXION_BLOQUEE", { cible: login });
      return {
        error: `Trop de tentatives. Réessayez dans ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`,
      };
    }
  }

  await ensureBootstrapAdmin();

  const user = await authenticate(login, password);
  if (!user) {
    // Message volontairement identique quel que soit le motif : ne pas révéler
    // quels identifiants existent dans l'annuaire.
    return { error: "Identifiant ou mot de passe incorrect." };
  }

  const session = await getSession();
  session.userId = user.id;
  await session.save();
  redirect("/");
}

/**
 * Demande d'un lien de connexion par e-mail (agents hors réseau).
 * Le message de retour est identique que l'adresse soit connue ou non : cette
 * page est publiée sur Internet, elle ne doit pas servir à énumérer les agents.
 */
export async function demanderLienAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@")) return { error: "Adresse e-mail invalide." };

  const g = await getGeneralSettings();
  if (!g.lienMagiqueActif) {
    return { error: "La connexion par e-mail n'est pas activée." };
  }

  const ip = clientIp(await headers());
  // L'espace agent n'est publié sur Internet que si PUBLIC_AGENT_ACCESS le
  // demande explicitement — même arbitrage que `PUBLIC_AGENT_PREFIXES` dans
  // src/proxy.ts. Sans cela, cette action serait un moyen de faire envoyer des
  // courriels par l'application depuis l'extérieur.
  if (process.env.PUBLIC_AGENT_ACCESS !== "1" && !estInterne(ip)) {
    return { error: HORS_RESEAU };
  }

  for (const cle of [`magic:${email.toLowerCase()}`, `magic-ip:${ip}`]) {
    if (!rateLimit(cle, 5, 900).ok) {
      return { error: "Trop de demandes. Réessayez dans quelques minutes." };
    }
  }

  await envoyerLienConnexion(email);
  return {
    success:
      "Si cette adresse correspond à un agent de la collectivité, un lien de connexion vient d'être envoyé. Il est valable 30 minutes.",
  };
}

export async function logoutAction(): Promise<void> {
  const session = await getSession();
  session.destroy();
  redirect("/connexion");
}
