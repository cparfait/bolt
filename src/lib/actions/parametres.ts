"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { reduireLogo } from "@/lib/logo";
import { ldapSearchGroups, ldapTest } from "@/lib/ldap";
import { synchroniserAnnuaire as synchroniserAnnuaireDepuisAd } from "@/lib/annuaire";
import { desactiverCompte } from "@/lib/departs";
import { envoyerMail } from "@/lib/mail";
import {
  getGeneralSettings,
  getLdapSettings,
  getSmtpSettings,
  setSetting,
  type LdapSettings,
  type SmtpSettings,
} from "@/lib/settings";
import {
  enregistrerTextesLegaux,
  getTextesLegaux,
  nouvelleCle,
  type Declaration,
  type MentionRgpd,
} from "@/lib/declarations";
import { compterAPurger, purgerInscriptions } from "@/lib/purge";
import { erreur, succes, type ActionState } from "./types";

function texte(formData: FormData, cle: string): string {
  return String(formData.get(cle) ?? "").trim();
}

const LOGO_TYPES_ACCEPTES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const LOGO_TAILLE_MAX = 300 * 1024; // 300 Ko : large pour un logo, contenu dans Setting.value

/**
 * Lit le logo envoyé, le convertit en data URI pour stockage dans Setting.
 * Aucun fichier choisi (input vide) → conserve le logo actuel. Case « Retirer
 * le logo » cochée → efface. Rejette les types et tailles hors gabarit.
 */
async function lireLogo(
  formData: FormData,
  actuel: string,
): Promise<{ logo: string; erreur?: string }> {
  if (formData.get("supprimerLogo") === "1") return { logo: "" };

  const fichier = formData.get("logo");
  // Aucun nouveau fichier : on repasse quand même l'existant par la réduction.
  // Les logos téléversés avant elle sont ainsi allégés au premier
  // enregistrement des paramètres, sans qu'il faille les retéléverser.
  if (!(fichier instanceof File) || fichier.size === 0) {
    return { logo: await reduireLogo(actuel) };
  }

  if (!LOGO_TYPES_ACCEPTES.includes(fichier.type)) {
    return { logo: actuel, erreur: "Le logo doit être une image PNG, JPEG, WebP ou SVG." };
  }
  if (fichier.size > LOGO_TAILLE_MAX) {
    return { logo: actuel, erreur: "Le logo doit faire moins de 300 Ko." };
  }

  const octets = Buffer.from(await fichier.arrayBuffer());
  return {
    logo: await reduireLogo(`data:${fichier.type};base64,${octets.toString("base64")}`),
  };
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
    // `exclure` : ne jamais se désactiver soi-même au milieu d'une
    // synchronisation. Le compte administrateur de secours est local, donc
    // hors du champ de toute façon (voir adosseALAnnuaire).
    const res = await synchroniserAnnuaireDepuisAd(cfg, admin.displayName, {
      exclure: admin.id,
    });
    revalidatePath("/parametres/annuaire");
    revalidatePath("/parametres/utilisateurs");
    revalidatePath("/agents");
    revalidatePath("/inscriptions");
    // Une lecture jugée incomplète n'est pas une erreur technique — les comptes
    // lus ont bien été mis à jour — mais elle demande une vérification : elle
    // s'affiche donc en avertissement plutôt qu'en succès.
    return res.lectureIncomplete ? erreur(res.message) : succes(res.message);
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
      `Test d'envoi depuis ${(await getGeneralSettings()).appName}`,
      "Ce message confirme que la messagerie est correctement configurée.",
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

  const { logo, erreur: erreurLogo } = await lireLogo(formData, actuel.logo);
  if (erreurLogo) return erreur(erreurLogo);

  // Les deux URL publiques servent de base aux liens envoyés par courriel
  // (src/lib/magic.ts, src/lib/coach-access.ts). Les réécrire suffirait à faire
  // partir les liens de connexion vers un hôte extérieur, et à en récolter les
  // jetons : le service des sports règle le métier, la DSI règle les adresses.
  const estAdmin = user.role === "ADMIN";
  const url = (cle: string, courant: string) =>
    estAdmin ? texte(formData, cle).replace(/\/+$/, "") : courant;

  const cfg = {
    // Un nom vide viderait tous les écrans à la fois : on conserve l'ancien.
    appName: texte(formData, "appName") || actuel.appName,
    appDescription: texte(formData, "appDescription") || actuel.appDescription,
    orgName: texte(formData, "orgName") || actuel.orgName,
    appUrl: url("appUrl", actuel.appUrl),
    pointageUrl: url("pointageUrl", actuel.pointageUrl),
    logo,
    contactEmail: texte(formData, "contactEmail"),
    maxInscriptionsParAgent: Math.max(0, Number(texte(formData, "maxInscriptionsParAgent")) || 0),
    // 0 = aucune purge. Le champ vide vaut donc « on ne purge pas », pas
    // « on purge tout » : le sens le moins destructeur gagne.
    conservationMois: Math.max(0, Number(texte(formData, "conservationMois")) || 0),
    validationRequise: formData.get("validationRequise") === "on",
    absencesAvantRelance: Math.max(1, Number(texte(formData, "absencesAvantRelance")) || 3),
    lienMagiqueActif: formData.get("lienMagiqueActif") === "on",
    demandeAccesActive: formData.get("demandeAccesActive") === "on",
    domaineAgents: texte(formData, "domaineAgents").replace(/^@/, "").toLowerCase(),
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
  // Une demande validée débouche sur un compte hors annuaire, sans mot de
  // passe : le lien e-mail est sa seule porte. Ouvrir le formulaire sans lui,
  // c'est créer des comptes auxquels personne ne peut se connecter.
  if (cfg.demandeAccesActive && !cfg.lienMagiqueActif) {
    return erreur(
      "Le formulaire de demande d'accès nécessite la connexion des agents par lien e-mail.",
    );
  }
  if (cfg.rappelsActifs && !smtpConfigure) {
    return erreur(
      "Les rappels de séance nécessitent une messagerie configurée (Paramètres → Messagerie).",
    );
  }

  await setSetting("general", cfg);
  await audit("PARAM_GENERAL", { userId: user.id });
  // Le nom de l'application figure sur presque tous les écrans — navigation,
  // titres d'onglet, écrans de connexion. Un renommage doit donc vider le cache
  // de l'arbre entier, et pas seulement de la page des paramètres.
  revalidatePath("/", "layout");
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

/**
 * Ouverture ou fermeture d'un accès par la DSI.
 *
 * Ne touche pas aux inscriptions : c'est un geste technique, et le rôle ADMIN
 * ferme parfois un accès sans qu'il s'agisse d'un départ. Retirer quelqu'un de
 * ses activités est une décision du service des sports, qui la prend depuis la
 * fiche de l'agent — où le choix lui est explicitement proposé.
 */
export async function basculerUtilisateur(userId: string): Promise<void> {
  const admin = await requireUser("ADMIN");
  if (userId === admin.id) return;
  const cible = await prisma.user.findUnique({ where: { id: userId } });
  if (!cible) return;

  if (cible.active) {
    await desactiverCompte(userId, {
      acteur: admin.displayName,
      desinscrire: false,
      motif: "accès fermé par la DSI",
    });
  } else {
    await prisma.user.update({ where: { id: userId }, data: { active: true } });
    await audit("COMPTE_ACTIVE", { userId: admin.id, cible: cible.login });
  }
  revalidatePath("/parametres/utilisateurs");
}

/**
 * Efface inscriptions et présences au-delà de la durée de conservation.
 *
 * Réservé à l'administrateur, et jamais automatique : l'effacement est
 * irréversible, il doit rester un geste. La durée appliquée est celle réglée
 * dans Paramètres → Général, pour qu'elle puisse coller à celle qu'annoncent
 * les mentions d'information.
 */
export async function purgerInscriptionsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser("ADMIN");
  const g = await getGeneralSettings();
  if (g.conservationMois <= 0) {
    return erreur(
      "Aucune durée de conservation n'est définie (Paramètres → Général). Rien n'a été effacé.",
    );
  }

  // Le décompte affiché sur le bouton est renvoyé avec la demande : s'il a
  // changé entre l'affichage et le clic, on s'arrête. L'administrateur doit
  // détruire ce qu'il a lu, pas ce qui se trouve là au moment du clic.
  const attendu = Number(texte(formData, "attendu"));
  const decompte = await compterAPurger(g.conservationMois);
  if (attendu !== decompte.inscriptions) {
    return erreur(
      `Le décompte a changé depuis l'affichage (${decompte.inscriptions} au lieu de ${attendu}). Rien n'a été effacé : rechargez la page et recommencez.`,
    );
  }
  if (decompte.inscriptions === 0 && decompte.presences === 0) {
    return succes("Rien à effacer : aucune saison n'est close depuis assez longtemps.");
  }

  const res = await purgerInscriptions(g.conservationMois, user.displayName);
  revalidatePath("/parametres/journal");
  return succes(
    `${res.inscriptions} inscription(s) et ${res.presences} présence(s) effacées définitivement.`,
  );
}

/** Une valeur de formulaire, sans le `trim` qui mangerait la mise en forme. */
function bloc(formData: FormData, cle: string): string {
  return String(formData.get(cle) ?? "").replace(/\r\n/g, "\n").trim();
}

/**
 * Publie les déclarations et mentions d'information.
 *
 * Une modification crée une nouvelle version archivée : les inscriptions déjà
 * enregistrées continuent de désigner le texte que leur agent a réellement lu.
 */
export async function enregistrerTextes(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const actuels = await getTextesLegaux();

  const declarations: Declaration[] = [];
  for (const [i, d] of actuels.declarations.entries()) {
    // Supprimée : la case « retirer » est cochée en face d'elle.
    if (formData.get(`retirer_${d.cle}`) === "on") continue;
    const t = bloc(formData, `declaration_${d.cle}`);
    if (!t) {
      return erreur(`La déclaration n°${i + 1} est vide. Retirez-la ou renseignez-la.`);
    }
    declarations.push({ cle: d.cle, texte: t });
  }
  const ajoutee = bloc(formData, "nouvelleDeclaration");
  if (ajoutee) declarations.push({ cle: nouvelleCle(), texte: ajoutee });

  if (declarations.length === 0) {
    return erreur("Il faut au moins une déclaration : sans elle, l'inscription n'engage à rien.");
  }

  const mentions: MentionRgpd[] = [];
  for (const m of actuels.mentions) {
    if (formData.get(`retirerMention_${m.intitule}`) === "on") continue;
    const intitule = texte(formData, `intitule_${m.intitule}`) || m.intitule;
    const corps = bloc(formData, `mention_${m.intitule}`);
    if (!corps) return erreur(`La mention « ${intitule} » est vide. Retirez-la ou renseignez-la.`);
    mentions.push({ intitule, texte: corps });
  }
  const intituleAjoute = texte(formData, "nouvelIntitule");
  const mentionAjoutee = bloc(formData, "nouvelleMention");
  if (intituleAjoute && mentionAjoutee) {
    mentions.push({ intitule: intituleAjoute, texte: mentionAjoutee });
  }

  // Deux mentions de même intitulé se marcheraient dessus au prochain
  // enregistrement : les champs du formulaire portent l'intitulé.
  if (new Set(mentions.map((m) => m.intitule)).size !== mentions.length) {
    return erreur("Deux mentions portent le même intitulé. Distinguez-les avant d'enregistrer.");
  }

  const consentement = bloc(formData, "rgpdConsentement");
  if (!consentement) {
    return erreur("La phrase de consentement ne peut pas être vide : c'est elle que l'agent coche.");
  }

  const { textes, publiee } = await enregistrerTextesLegaux(
    {
      declarations,
      rgpdPreambule: bloc(formData, "rgpdPreambule"),
      mentions,
      rgpdRecours: bloc(formData, "rgpdRecours"),
      rgpdConsentement: consentement,
    },
    user.displayName,
  );

  if (!publiee) return succes("Aucune modification : les textes sont inchangés.");

  await audit("TEXTES_PUBLIES", {
    userId: user.id,
    details: `version ${textes.version}`,
  });
  revalidatePath("/parametres/declarations");
  revalidatePath("/mentions");
  revalidatePath("/mes-activites");
  return succes(`Version ${textes.version} publiée. Elle s'applique aux prochaines inscriptions.`);
}
