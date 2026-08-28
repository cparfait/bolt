"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { authenticate, ensureBootstrapAdmin, resoudreIdentifiant } from "@/lib/auth";
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

/**
 * Nombre maximal de liens de connexion expédiés en une heure sur demande
 * venue d'Internet, toutes adresses et toutes sources confondues.
 *
 * Dimensionné sur l'usage réel, pas sur une prudence abstraite : même le jour
 * de l'ouverture des inscriptions, les demandes se comptent en dizaines. 200
 * laisse donc une marge confortable tout en divisant par cent le volume qu'une
 * attaque pourrait faire sortir. Si le journal montre des
 * « LIEN_MAGIQUE_PLAFOND » sans attaque, c'est ce chiffre qu'il faut relever.
 */
const PLAFOND_HORAIRE = 200;

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const saisie = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!saisie || !password) {
    return { error: "Renseignez votre identifiant et votre mot de passe." };
  }

  const ip = clientIp(await headers());
  if (!estInterne(ip)) {
    await audit("CONNEXION_HORS_RESEAU", { cible: saisie });
    return { error: HORS_RESEAU };
  }

  const bloque = (cle: string) => {
    const rl = rateLimit(cle, 10, 300);
    return rl.ok
      ? null
      : `Trop de tentatives. Réessayez dans ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`;
  };

  // Anti-bruteforce, par adresse d'abord : ce compteur-là ne coûte aucune
  // requête, et doit rester devant la résolution de l'identifiant.
  const parIp = bloque(`ip:${ip}`);
  if (parIp) {
    await audit("CONNEXION_BLOQUEE", { cible: saisie });
    return { error: parIp };
  }

  // L'agent saisit son identifiant Windows ou son adresse : les deux mènent au
  // même compte. Le compteur porte sur l'identifiant RÉSOLU — sinon alterner
  // les deux formes de la même identité doublerait le nombre d'essais permis.
  const login = await resoudreIdentifiant(saisie);
  const parLogin = bloque(`login:${login}`);
  if (parLogin) {
    await audit("CONNEXION_BLOQUEE", { cible: saisie });
    return { error: parLogin };
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

  // Plafond global, sans clé d'identité.
  //
  // Les deux compteurs ci-dessous sont indexés sur une identité — une adresse,
  // une IP. Chacun fait bien son travail, mais ils partagent un angle mort :
  // une source distribuée les contourne en faisant varier les deux, et aucun
  // ne se remplit jamais. Avec un millier d'adresses IP, ce qui coûte quelques
  // euros, cette action expédierait 20 000 courriels par heure sous le domaine
  // de la collectivité. Le dommage n'est pas la fuite — chaque lien part à son
  // seul destinataire et expire en 30 minutes — c'est la réputation
  // d'expéditeur, qui met des semaines à se réparer et emporte avec elle tout
  // le courrier de la mairie.
  //
  // Il ne vaut que pour l'extérieur : pendant une attaque, un agent sur le
  // réseau ou en VPN doit continuer à recevoir son lien. Sans cette réserve,
  // le plafond deviendrait lui-même un déni de service à bas prix.
  //
  // La ligne d'audit n'est pas décorative : c'est le seul signal qui dira que
  // le plafond a servi, donc qu'on vous attaque.
  if (!estInterne(ip) && !rateLimit("magic:global", PLAFOND_HORAIRE, 3600).ok) {
    await audit("LIEN_MAGIQUE_PLAFOND", { cible: email });
    return { error: "Trop de demandes en cours. Réessayez dans quelques minutes." };
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
