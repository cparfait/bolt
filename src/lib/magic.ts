import { randomBytes } from "node:crypto";
import type { Role } from "@prisma/client";
import { prisma } from "./db";
import { adresseDeContact } from "./comptes";
import { nomPourSalutation } from "./constants";
import { getGeneralSettings, urlEspaceAgent } from "./settings";
import { envoyerMail } from "./mail";
import { audit } from "./audit";

/**
 * Connexion sans mot de passe, par lien envoyé sur l'adresse professionnelle.
 *
 * Destinée aux agents qui n'ont pas de poste sur le réseau. Elle ne remplace
 * pas l'authentification Active Directory : elle s'y appuie. Seule une adresse
 * déjà connue de l'annuaire (miroir AdAccount, ou compte Bolt existant) reçoit
 * un lien — impossible de créer une identité en saisissant un nom.
 *
 * Jeton à usage unique, valable 30 minutes.
 */

const VALIDITE_MINUTES = 30;

/**
 * Qui peut ouvrir une session depuis Internet.
 *
 * Tout le monde sauf ADMIN — et ce n'est pas un relâchement : ce qu'une session
 * venue d'Internet peut FAIRE est borné ailleurs, par `requireUser`
 * (src/lib/session.ts), qui refuse tout écran et toute action de gestion à une
 * requête externe. Un gestionnaire connecté de chez lui atteint son espace
 * personnel, rien d'autre.
 *
 * La première version refusait la connexion à tout ce qui n'était pas AGENT.
 * C'était plus simple, et trop large : le service des sports est aussi composé
 * d'agents qui font du sport, et on leur fermait leurs propres inscriptions.
 *
 * ADMIN reste bloqué au seuil, en défense de profondeur : c'est le rôle qui
 * passe tous les contrôles de rôle, il tient dans une poignée de personnes, et
 * elles ont le VPN. Si une action de gestion échappait un jour à `requireUser`,
 * autant qu'aucune session d'administrateur ne puisse exister dehors.
 *
 * Les animateurs prestataires ne passent pas par ce mécanisme mais par leur
 * jeton et leur PIN : rien ne change pour eux.
 */
export function autoriseDepuisInternet(role: Role): boolean {
  return role !== "ADMIN";
}

/**
 * L'adresse est-elle déjà rattachée à quelqu'un ?
 *
 * Même périmètre que `envoyerLienConnexion` : un compte Bolt actif — par son
 * adresse d'annuaire ou son adresse de contact — ou une entrée du miroir
 * d'annuaire. Sert à l'écran d'accès pour décider s'il envoie un lien ou s'il
 * propose de demander un accès. N'écrit rien et n'envoie rien.
 */
export async function adresseConnue(emailBrut: string): Promise<boolean> {
  const email = emailBrut.trim().toLowerCase();
  if (!email.includes("@")) return false;

  const compte = await prisma.user.findFirst({
    where: {
      active: true,
      OR: [
        { email: { equals: email, mode: "insensitive" } },
        { emailContact: { equals: email, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  if (compte) return true;

  const ad = await prisma.adAccount.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, enabled: true },
    select: { samAccountName: true },
  });
  return ad !== null;
}

/**
 * Envoie un lien de connexion. Renvoie toujours le même message, que l'adresse
 * soit connue ou non : l'écran de connexion ne doit pas permettre de savoir qui
 * travaille dans la collectivité.
 */
export async function envoyerLienConnexion(
  emailBrut: string,
  options: { externe: boolean },
): Promise<void> {
  const email = emailBrut.trim().toLowerCase();
  if (!email.includes("@")) return;

  const g = await getGeneralSettings();
  if (!g.lienMagiqueActif) return;

  // L'agent saisit l'adresse qu'il connaît : celle de l'annuaire, ou celle que
  // le service des sports a enregistrée pour lui. Les deux ouvrent l'accès.
  let user = await prisma.user.findFirst({
    where: {
      active: true,
      OR: [
        { email: { equals: email, mode: "insensitive" } },
        { emailContact: { equals: email, mode: "insensitive" } },
      ],
    },
  });

  // Adresse absente de Bolt : on la cherche dans le miroir de l'annuaire et on
  // crée le compte correspondant, avec son rattachement hiérarchique.
  if (!user) {
    const ad = await prisma.adAccount.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, enabled: true },
    });
    if (!ad) {
      await audit("LIEN_MAGIQUE_INCONNU", { cible: email });
      return;
    }
    user = await prisma.user.upsert({
      where: { login: ad.samAccountName.toLowerCase() },
      update: { email: ad.email, active: true },
      create: {
        login: ad.samAccountName.toLowerCase(),
        displayName: ad.displayName ?? ad.samAccountName,
        email: ad.email,
        direction: ad.direction,
        service: ad.service,
        role: "AGENT",
        isLocal: false,
      },
    });
  }

  // Un administrateur qui demande son lien depuis Internet ne reçoit rien. Le
  // silence est volontaire — l'appelant renvoie le même message à tout le
  // monde, et dire « votre compte ne peut pas se connecter ainsi » désignerait
  // les comptes privilégiés à qui les cherche.
  if (options.externe && !autoriseDepuisInternet(user.role)) {
    await audit("LIEN_MAGIQUE_REFUS_ROLE", { userId: user.id, cible: email });
    return;
  }

  // Les liens précédents deviennent caducs : un seul lien valide à la fois.
  await prisma.magicToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = randomBytes(32).toString("base64url");
  await prisma.magicToken.create({
    data: {
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + VALIDITE_MINUTES * 60 * 1000),
    },
  });

  const base = urlEspaceAgent(g);
  // Doit pointer sur l'écran de confirmation qui consomme le jeton
  // (src/app/acces/lien/page.tsx) : toute autre adresse renvoie un 404, et le
  // lien reçu par courriel devient une impasse.
  const lien = `${base}/acces/lien?token=${token}`;

  const envoi = await envoyerMail(
    adresseDeContact(user)!,
    `Votre lien de connexion à ${g.appName}`,
    [
      `Bonjour ${nomPourSalutation(user.displayName)},`,
      `Voici votre accès aux activités sportives. Il est valable ${VALIDITE_MINUTES} minutes et ne sert qu'une fois — ensuite vous restez connecté sur cet appareil, sans avoir à le redemander.`,
      `[Me connecter](${lien})`,
      `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucun accès n'a été ouvert.`,
    ].join("\n\n"),
  );
  // Le résultat de l'envoi, et pas seulement l'intention. L'agent qui ne reçoit
  // rien appelle le service des sports, qui ouvre le journal : y lire
  // « ENVOYE » alors que le SMTP a refusé envoie chercher la panne du côté de
  // la messagerie de l'agent, c'est-à-dire nulle part. C'est la seule trace
  // qu'on ait de ce parcours — elle doit dire ce qui s'est réellement passé.
  await audit(envoi.ok ? "LIEN_MAGIQUE_ENVOYE" : "LIEN_MAGIQUE_ECHEC", {
    userId: user.id,
    details: envoi.ok ? undefined : envoi.message,
  });
}

/** Consomme un jeton et renvoie l'utilisateur, ou null si invalide/expiré. */
export async function consommerLien(token: string, options: { externe: boolean }) {
  if (!token) return null;
  const row = await prisma.magicToken.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  if (!row.user.active) return null;

  // Second passage de la même règle qu'à l'envoi : un lien demandé depuis le
  // réseau, puis ouvert depuis l'extérieur, n'ouvre pas de session
  // d'administrateur. Le jeton n'est PAS consommé — il servira en arrivant au
  // bureau, plutôt que d'être brûlé en le lisant dans le train.
  if (options.externe && !autoriseDepuisInternet(row.user.role)) {
    await audit("LIEN_MAGIQUE_REFUS_ROLE", { userId: row.userId });
    return null;
  }

  // Marquage à usage unique : la mise à jour conditionnelle empêche deux
  // requêtes simultanées de consommer le même jeton.
  const consomme = await prisma.magicToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consomme.count === 0) return null;

  await prisma.user.update({
    where: { id: row.userId },
    data: { lastLoginAt: new Date() },
  });
  await audit("CONNEXION_LIEN", { userId: row.userId });
  return row.user;
}
