"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ldapFetchAccounts, ldapSearchGroups, ldapTest } from "@/lib/ldap";
import { envoyerMail } from "@/lib/mail";
import {
  getGeneralSettings,
  getLdapSettings,
  getSmtpSettings,
  setSetting,
  type LdapSettings,
  type SmtpSettings,
} from "@/lib/settings";
import { erreur, succes, type ActionState } from "./types";

function texte(formData: FormData, cle: string): string {
  return String(formData.get(cle) ?? "").trim();
}

/**
 * Enregistre la configuration de l'annuaire.
 * Le mot de passe du compte de service n'est jamais réaffiché : un champ laissé
 * vide conserve la valeur existante.
 */
export async function enregistrerLdap(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("ADMIN");
  const actuel = await getLdapSettings();

  const url = texte(formData, "url");
  const baseDn = texte(formData, "baseDn");
  if (!url || !baseDn) return erreur("Le serveur et le Base DN sont obligatoires.");

  const motDePasse = texte(formData, "bindPassword");
  const cfg: LdapSettings = {
    enabled: formData.get("enabled") === "on",
    url,
    port: Number(texte(formData, "port")) || undefined,
    useSsl: formData.get("useSsl") === "on",
    caCert: texte(formData, "caCert") || undefined,
    baseDn,
    bindDn: texte(formData, "bindDn") || undefined,
    bindPassword: motDePasse || actuel?.bindPassword,
    upnSuffix: texte(formData, "upnSuffix") || undefined,
    userDnTemplate: texte(formData, "userDnTemplate") || undefined,
    requiredGroup: texte(formData, "requiredGroup") || undefined,
    gestionnaireGroup: texte(formData, "gestionnaireGroup") || undefined,
    tlsRejectUnauthorized: formData.get("tlsRejectUnauthorized") === "on",
  };

  await setSetting("ldap", cfg);
  await audit("PARAM_LDAP", { userId: admin.id, details: cfg.url });
  revalidatePath("/parametres/annuaire");

  if (formData.get("tester") === "1") {
    const res = await ldapTest(cfg);
    return res.ok ? succes(res.message) : erreur(res.message);
  }
  return succes("Configuration de l'annuaire enregistrée.");
}

/**
 * Suggestions de groupes AD pour les champs de restriction d'accès.
 *
 * Une faute de frappe sur « Groupe AD requis » verrouille l'application pour
 * tout le monde (la vérification est fail-closed) : proposer les noms réels de
 * l'annuaire évite l'erreur la plus coûteuse du paramétrage.
 */
export async function rechercherGroupes(
  query: string,
): Promise<{ cn: string; dn: string }[]> {
  await requireUser("ADMIN");
  const cfg = await getLdapSettings();
  if (!cfg?.bindDn || !cfg?.bindPassword) return [];
  try {
    return await ldapSearchGroups(cfg, query, 12);
  } catch {
    return []; // annuaire injoignable : le champ reste saisissable à la main
  }
}

export async function testerLdap(): Promise<ActionState> {
  await requireUser("ADMIN");
  const cfg = await getLdapSettings();
  if (!cfg) return erreur("Configurez d'abord l'annuaire.");
  const res = await ldapTest(cfg);
  return res.ok ? succes(res.message) : erreur(res.message);
}

/**
 * Synchronise le miroir de l'annuaire.
 *
 * Lecture seule : Bolt n'écrit jamais dans l'Active Directory. Le miroir sert à
 * inscrire un agent sans interroger le DC à chaque frappe, et à alimenter les
 * statistiques par direction.
 */
export async function synchroniserAnnuaire(): Promise<ActionState> {
  const admin = await requireUser("ADMIN");
  const cfg = await getLdapSettings();
  if (!cfg) return erreur("Configurez d'abord l'annuaire.");

  try {
    const comptes = await ldapFetchAccounts(cfg);
    for (const c of comptes) {
      const { samAccountName, ...rest } = c;
      await prisma.adAccount.upsert({
        where: { samAccountName },
        update: { ...rest, syncedAt: new Date() },
        create: { samAccountName, ...rest, syncedAt: new Date() },
      });
    }

    // Rattachement hiérarchique des comptes Bolt déjà connus : les
    // statistiques par direction restent justes même sans reconnexion.
    for (const c of comptes) {
      await prisma.user.updateMany({
        where: { login: c.samAccountName.toLowerCase() },
        data: { direction: c.direction, service: c.service },
      });
    }

    await audit("ANNUAIRE_SYNCHRONISE", {
      userId: admin.id,
      details: `${comptes.length} comptes`,
    });
    revalidatePath("/parametres/annuaire");
    return succes(`${comptes.length} comptes synchronisés depuis l'annuaire.`);
  } catch (e) {
    return erreur(e instanceof Error ? e.message : String(e));
  }
}

export async function enregistrerSmtp(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("ADMIN");
  const actuel = await getSmtpSettings();
  const host = texte(formData, "host");
  const from = texte(formData, "from");
  if (!host || !from) return erreur("Le serveur et l'expéditeur sont obligatoires.");

  const pass = texte(formData, "pass");
  const cfg: SmtpSettings = {
    host,
    port: Number(texte(formData, "port")) || 25,
    secure: formData.get("secure") === "on",
    user: texte(formData, "user") || undefined,
    pass: pass || actuel?.pass,
    from,
    tlsRejectUnauthorized: formData.get("tlsRejectUnauthorized") === "on",
  };

  await setSetting("smtp", cfg);
  await audit("PARAM_SMTP", { userId: admin.id, details: cfg.host });
  revalidatePath("/parametres/messagerie");

  const destinataire = texte(formData, "test");
  // L'envoi n'a lieu que si l'utilisateur a cliqué sur le bouton de test :
  // enregistrer une configuration ne doit pas expédier un message au passage.
  if (formData.get("tester") === "1") {
    if (!destinataire) {
      return erreur("Renseignez une adresse de destination pour l'envoi de test.");
    }
    const res = await envoyerMail(
      destinataire,
      "Test d'envoi depuis Bolt",
      "Ce message confirme que la messagerie de Bolt est correctement configurée.",
    );
    return res.ok ? succes(res.message) : erreur(res.message);
  }
  return succes("Configuration de la messagerie enregistrée.");
}

export async function enregistrerGeneral(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const actuel = await getGeneralSettings();
  const cfg = {
    orgName: texte(formData, "orgName") || actuel.orgName,
    appUrl: texte(formData, "appUrl").replace(/\/+$/, ""),
    contactEmail: texte(formData, "contactEmail"),
    maxInscriptionsParAgent: Math.max(0, Number(texte(formData, "maxInscriptionsParAgent")) || 0),
    validationRequise: formData.get("validationRequise") === "on",
    absencesAvantRelance: Math.max(1, Number(texte(formData, "absencesAvantRelance")) || 3),
    lienMagiqueActif: formData.get("lienMagiqueActif") === "on",
    rappelsActifs: formData.get("rappelsActifs") === "on",
    rappelHeuresAvant: Math.min(
      168,
      Math.max(1, Number(texte(formData, "rappelHeuresAvant")) || 24),
    ),
  };

  const smtpConfigure = Boolean((await getSmtpSettings())?.host);
  if (cfg.lienMagiqueActif && !smtpConfigure) {
    return erreur(
      "La connexion par e-mail nécessite une messagerie configurée (Paramètres → Messagerie).",
    );
  }
  if (cfg.rappelsActifs && !smtpConfigure) {
    return erreur(
      "Les rappels de séance nécessitent une messagerie configurée (Paramètres → Messagerie).",
    );
  }

  await setSetting("general", cfg);
  await audit("PARAM_GENERAL", { userId: user.id });
  revalidatePath("/parametres");
  return succes("Paramètres enregistrés.");
}

/** Change le rôle d'un compte (promotion d'un gestionnaire, retrait d'accès). */
export async function changerRole(userId: string, role: string): Promise<void> {
  const admin = await requireUser("ADMIN");
  if (!["ADMIN", "GESTIONNAIRE", "COACH", "AGENT"].includes(role)) return;
  if (userId === admin.id) return; // ne pas se retirer soi-même l'administration

  const cible = await prisma.user.findUnique({ where: { id: userId } });
  if (!cible) return;
  await prisma.user.update({
    where: { id: userId },
    data: { role: role as "ADMIN" | "GESTIONNAIRE" | "COACH" | "AGENT" },
  });
  await audit("ROLE_MODIFIE", {
    userId: admin.id,
    cible: cible.login,
    details: `${cible.role} → ${role}`,
  });
  revalidatePath("/parametres/utilisateurs");
}

export async function basculerUtilisateur(userId: string): Promise<void> {
  const admin = await requireUser("ADMIN");
  if (userId === admin.id) return;
  const cible = await prisma.user.findUnique({ where: { id: userId } });
  if (!cible) return;
  await prisma.user.update({ where: { id: userId }, data: { active: !cible.active } });
  await audit(cible.active ? "COMPTE_DESACTIVE" : "COMPTE_ACTIVE", {
    userId: admin.id,
    cible: cible.login,
  });
  revalidatePath("/parametres/utilisateurs");
}
