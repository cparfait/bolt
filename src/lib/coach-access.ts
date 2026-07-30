import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Coach } from "@prisma/client";
import { prisma } from "./db";
import { getSession } from "./session";
import { audit } from "./audit";
import { rateLimit, resetRateLimit } from "./rate-limit";

/**
 * Accès distant des animateurs — le point sensible de l'application.
 *
 * Les animateurs ne sont pas sur le réseau de la collectivité : leur feuille
 * d'émargement doit être joignable depuis Internet. Plutôt que d'exposer une
 * authentification Active Directory à l'extérieur, chaque animateur reçoit un
 * lien porteur d'un jeton aléatoire (32 octets) et un code à 6 chiffres.
 *
 * Le jeton seul ne suffit pas : il peut fuiter (historique de navigation, SMS
 * transféré, capture d'écran). Le PIN est le second facteur, stocké haché, avec
 * un verrouillage persisté en base après 5 essais — donc résistant à un
 * redémarrage du conteneur, contrairement à un simple compteur en mémoire.
 */

const PIN_ESSAIS_MAX = 5;
const PIN_VERROU_MINUTES = 15;
// Durée pendant laquelle un PIN validé évite de le redemander sur ce téléphone.
const PIN_VALIDITE_MS = 8 * 60 * 60 * 1000;

export function genererToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Codes trop devinables : ils tomberaient dans les premiers essais d'une
 * attaque, et surtout ce sont ceux que l'on choisit spontanément.
 *
 *  • six chiffres identiques — 000000, 111111… ;
 *  • suites croissantes ou décroissantes — 123456, 654321, 456789 ;
 *  • motifs à deux ou trois chiffres répétés — 121212, 123123 ;
 *  • quelques classiques indépendants de toute règle.
 */
const PINS_INTERDITS = new Set(["102030", "112233", "696969", "007007"]);

export function pinFaible(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return "Le code doit comporter exactement 6 chiffres.";
  if (/^(\d)\1{5}$/.test(pin)) return "Un code à six chiffres identiques est trop simple.";

  const chiffres = [...pin].map(Number);
  const croissant = chiffres.every((c, i) => i === 0 || c === chiffres[i - 1] + 1);
  const decroissant = chiffres.every((c, i) => i === 0 || c === chiffres[i - 1] - 1);
  if (croissant || decroissant) {
    return "Une suite de chiffres qui se suivent est trop simple.";
  }

  const motif2 = pin.slice(0, 2);
  const motif3 = pin.slice(0, 3);
  if (pin === motif2.repeat(3) || pin === motif3.repeat(2)) {
    return "Un motif répété est trop simple.";
  }
  if (PINS_INTERDITS.has(pin)) return "Ce code est trop courant.";
  return null;
}

/** Tire un code aléatoire, en écartant ceux que l'on refuserait à la saisie. */
export function genererPin(): string {
  for (let i = 0; i < 50; i++) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    if (!pinFaible(pin)) return pin;
  }
  // Statistiquement inatteignable : moins de 0,01 % de codes refusés.
  return "428617";
}

export function lienEmargement(token: string, appUrl?: string): string {
  const base = (
    appUrl ||
    process.env.BOLT_POINTAGE_URL ||
    process.env.BOLT_PUBLIC_URL ||
    ""
  ).replace(/\/+$/, "");
  return `${base}/emargement/${token}`;
}

/**
 * Attribue (ou renouvelle) un accès par lien : nouveau jeton, nouveau PIN.
 * Le PIN en clair n'est renvoyé qu'ici — il n'est jamais relu ensuite.
 */
export async function attribuerLien(
  coachId: string,
  expiresAt: Date | null,
): Promise<{ token: string; pin: string }> {
  const token = genererToken();
  const pin = genererPin();
  await prisma.coach.update({
    where: { id: coachId },
    data: {
      acces: "LIEN",
      token,
      pinHash: await bcrypt.hash(pin, 12),
      tokenCreatedAt: new Date(),
      tokenExpiresAt: expiresAt,
      pinFailedCount: 0,
      pinLockedUntil: null,
      lastAccessAt: null,
      lastAccessIp: null,
    },
  });
  return { token, pin };
}

export async function revoquerLien(coachId: string): Promise<void> {
  await prisma.coach.update({
    where: { id: coachId },
    data: {
      token: null,
      pinHash: null,
      tokenCreatedAt: null,
      tokenExpiresAt: null,
      pinFailedCount: 0,
      pinLockedUntil: null,
    },
  });
}

export type EtatLien =
  | { etat: "INCONNU" }
  | { etat: "EXPIRE"; coach: Coach }
  | { etat: "DESACTIVE"; coach: Coach }
  | { etat: "PIN_REQUIS"; coach: Coach; verrouJusqua: Date | null }
  | { etat: "OUVERT"; coach: Coach };

/**
 * Résout un jeton d'émargement et l'état de la session en cours.
 * Ne révèle jamais l'existence d'un animateur : un jeton inconnu et un jeton
 * révoqué donnent le même écran côté visiteur.
 */
export async function resoudreLien(token: string): Promise<EtatLien> {
  if (!token || token.length < 20) return { etat: "INCONNU" };
  const coach = await prisma.coach.findUnique({ where: { token } });
  if (!coach || !coach.token) return { etat: "INCONNU" };
  if (!coach.actif) return { etat: "DESACTIVE", coach };
  if (coach.tokenExpiresAt && coach.tokenExpiresAt < new Date()) {
    return { etat: "EXPIRE", coach };
  }

  const session = await getSession();
  const pinValide =
    session.coachId === coach.id &&
    typeof session.coachPinAt === "number" &&
    Date.now() - session.coachPinAt < PIN_VALIDITE_MS;

  // Un animateur sans PIN (cas de figure théorique : lien créé puis PIN effacé)
  // reste protégé : on exige la réattribution d'un lien complet.
  if (!coach.pinHash) return { etat: "INCONNU" };
  if (pinValide) return { etat: "OUVERT", coach };

  const verrouJusqua =
    coach.pinLockedUntil && coach.pinLockedUntil > new Date() ? coach.pinLockedUntil : null;
  return { etat: "PIN_REQUIS", coach, verrouJusqua };
}

export type ResultatPin =
  | { ok: true }
  | { ok: false; message: string; verrouJusqua?: Date };

/**
 * Vérifie le code à 6 chiffres et ouvre la session animateur.
 * Double garde-fou : limitation par IP (mémoire) et verrouillage du compte
 * animateur après 5 échecs (base).
 */
export async function verifierPin(
  token: string,
  pin: string,
  ip: string,
): Promise<ResultatPin> {
  const coach = await prisma.coach.findUnique({ where: { token } });
  if (!coach || !coach.token || !coach.pinHash || !coach.actif) {
    return { ok: false, message: "Lien invalide." };
  }
  if (coach.tokenExpiresAt && coach.tokenExpiresAt < new Date()) {
    return { ok: false, message: "Ce lien a expiré. Contactez le service des sports." };
  }

  const maintenant = new Date();
  if (coach.pinLockedUntil && coach.pinLockedUntil > maintenant) {
    return {
      ok: false,
      message: "Trop d'essais. Réessayez dans quelques minutes.",
      verrouJusqua: coach.pinLockedUntil,
    };
  }

  // Coupe-circuit indépendant du compte : empêche un balayage depuis une IP.
  const parIp = rateLimit(`pin:${ip}`, 20, 600);
  if (!parIp.ok) {
    return { ok: false, message: "Trop de tentatives depuis cet appareil. Patientez." };
  }

  const propre = pin.replace(/\D/g, "");
  const ok = propre.length === 6 && (await bcrypt.compare(propre, coach.pinHash));

  if (!ok) {
    const essais = coach.pinFailedCount + 1;
    const verrouille = essais >= PIN_ESSAIS_MAX;
    await prisma.coach.update({
      where: { id: coach.id },
      data: {
        pinFailedCount: verrouille ? 0 : essais,
        pinLockedUntil: verrouille
          ? new Date(Date.now() + PIN_VERROU_MINUTES * 60 * 1000)
          : null,
      },
    });
    await audit("EMARGEMENT_PIN_ECHEC", {
      acteur: `${coach.prenom} ${coach.nom}`,
      cible: coach.id,
      details: verrouille ? `verrouillé ${PIN_VERROU_MINUTES} min` : `essai ${essais}/${PIN_ESSAIS_MAX}`,
    });
    return {
      ok: false,
      message: verrouille
        ? `Trop d'essais : accès bloqué ${PIN_VERROU_MINUTES} minutes.`
        : `Code incorrect (${PIN_ESSAIS_MAX - essais} essai${PIN_ESSAIS_MAX - essais > 1 ? "s" : ""} restant${PIN_ESSAIS_MAX - essais > 1 ? "s" : ""}).`,
    };
  }

  await prisma.coach.update({
    where: { id: coach.id },
    data: {
      pinFailedCount: 0,
      pinLockedUntil: null,
      lastAccessAt: maintenant,
      lastAccessIp: ip || null,
    },
  });
  resetRateLimit(`pin:${ip}`);

  const session = await getSession();
  session.coachId = coach.id;
  session.coachPinAt = Date.now();
  await session.save();

  await audit("EMARGEMENT_ACCES", {
    acteur: `${coach.prenom} ${coach.nom}`,
    cible: coach.id,
  });
  return { ok: true };
}

/**
 * Changement du code par l'animateur lui-même, depuis son espace.
 *
 * Le code initial est tiré au hasard et transmis par courriel : illisible à
 * retenir, il finit noté sur un papier ou dans les notes du téléphone. Pouvoir
 * le remplacer par un code choisi est plus sûr en pratique — à condition
 * d'écarter les codes trop devinables, d'où `pinFaible`.
 *
 * L'ancien code est exigé : un téléphone déverrouillé laissé sur une table ne
 * doit pas permettre de s'approprier l'accès.
 */
export async function changerPin(
  coachId: string,
  ancien: string,
  nouveau: string,
): Promise<{ ok: boolean; message: string }> {
  const coach = await prisma.coach.findUnique({ where: { id: coachId } });
  if (!coach || !coach.pinHash) return { ok: false, message: "Accès introuvable." };

  const ancienPropre = ancien.replace(/\D/g, "");
  if (!(await bcrypt.compare(ancienPropre, coach.pinHash))) {
    await audit("EMARGEMENT_PIN_CHANGE_ECHEC", {
      acteur: `${coach.prenom} ${coach.nom}`,
      cible: coach.id,
    });
    return { ok: false, message: "Code actuel incorrect." };
  }

  const nouveauPropre = nouveau.replace(/\D/g, "");
  const faiblesse = pinFaible(nouveauPropre);
  if (faiblesse) return { ok: false, message: faiblesse };
  if (nouveauPropre === ancienPropre) {
    return { ok: false, message: "Le nouveau code doit être différent de l'actuel." };
  }

  await prisma.coach.update({
    where: { id: coachId },
    data: { pinHash: await bcrypt.hash(nouveauPropre, 12), pinFailedCount: 0, pinLockedUntil: null },
  });
  await audit("EMARGEMENT_PIN_CHANGE", {
    acteur: `${coach.prenom} ${coach.nom}`,
    cible: coach.id,
  });
  return { ok: true, message: "Code modifié. Utilisez-le à votre prochaine connexion." };
}

/** Ferme la session animateur (bouton « Quitter » de la feuille). */
export async function fermerSessionCoach(): Promise<void> {
  const session = await getSession();
  session.coachId = undefined;
  session.coachPinAt = undefined;
  await session.save();
}

/**
 * Coach autorisé pour la requête en cours, via le jeton ET la session PIN.
 * Utilisé par les actions serveur de la feuille d'émargement : le jeton présent
 * dans l'URL ne suffit jamais à écrire.
 */
export async function coachAutorise(token: string): Promise<Coach | null> {
  const lien = await resoudreLien(token);
  return lien.etat === "OUVERT" ? lien.coach : null;
}
