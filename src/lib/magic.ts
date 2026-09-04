import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { adresseDeContact } from "./comptes";
import { prenomDe } from "./constants";
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
 * Envoie un lien de connexion. Renvoie toujours le même message, que l'adresse
 * soit connue ou non : l'écran de connexion ne doit pas permettre de savoir qui
 * travaille dans la collectivité.
 */
export async function envoyerLienConnexion(emailBrut: string): Promise<void> {
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
  // Doit pointer sur le gestionnaire de route qui consomme le jeton
  // (src/app/acces/lien/route.ts) : toute autre adresse renvoie un 404, et le
  // lien reçu par courriel devient une impasse.
  const lien = `${base}/acces/lien?token=${token}`;

  await envoyerMail(
    adresseDeContact(user)!,
    `Votre lien de connexion à ${g.appName}`,
    [
      `Bonjour ${prenomDe(user.displayName)},`,
      `Voici votre lien de connexion aux activités sportives. Il est valable ${VALIDITE_MINUTES} minutes et ne fonctionne qu'une seule fois.`,
      lien,
      `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucun accès n'a été ouvert.`,
    ].join("\n\n"),
  );
  await audit("LIEN_MAGIQUE_ENVOYE", { userId: user.id });
}

/** Consomme un jeton et renvoie l'utilisateur, ou null si invalide/expiré. */
export async function consommerLien(token: string) {
  if (!token) return null;
  const row = await prisma.magicToken.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  if (!row.user.active) return null;

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
