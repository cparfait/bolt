import { prisma } from "./db";

export type LdapSettings = {
  enabled?: boolean; // interrupteur ; absent/true = actif
  url: string; // hôte simple (dc01.chatillon.lan) ou ldaps://dc01…:636
  port?: number; // port explicite (636 LDAPS / 389 LDAP par défaut)
  useSsl?: boolean; // forcer LDAPS même si l'URL n'a pas de schéma
  caCert?: string; // chemin du fichier CA (PEM) pour une AC interne — ou contenu PEM
  baseDn: string; // DC=chatillon,DC=lan
  bindDn?: string; // compte de service (lecture seule)
  bindPassword?: string;
  upnSuffix?: string; // chatillon.lan — bind utilisateur en login@suffixe
  userDnTemplate?: string; // gabarit DN, ex. « CN={username},OU=Agents,DC=x »
  requiredGroup?: string; // seul un membre (imbriqué) de ce groupe peut se connecter
  gestionnaireGroup?: string; // membres promus GESTIONNAIRE à la connexion
  tlsRejectUnauthorized: boolean;
};

export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string; // « Bolt <sport@chatillon92.fr> »
  tlsRejectUnauthorized?: boolean; // absent = true (vérifier le certificat)
};

export type GeneralSettings = {
  /**
   * Nom de l'application, tel qu'il s'affiche partout : écrans de connexion,
   * navigation, onglet du navigateur, signature et objet des courriels,
   * application installée sur le téléphone des animateurs, classeur Excel.
   *
   * « Bolt » est un nom de code, et une collectivité qui déploie l'outil
   * préfère souvent le sien. Un champ plutôt qu'une constante : le renommage ne
   * doit pas demander une reconstruction de l'image.
   */
  appName: string;
  /** Ce que fait l'application, affiché à côté de son nom. */
  appDescription: string;
  orgName: string;
  appUrl: string; // https://bolt.chatillon92.fr — utilisé dans les liens envoyés
  // Nom public de l'application, quand elle est publiée sur Internet sous un
  // autre nom que le back-office (ex. https://chatbouge.chatillon92.fr).
  //
  // Le champ s'appelle encore `pointageUrl` : il ne portait au départ que les
  // liens d'émargement. Il porte désormais aussi les liens de connexion des
  // agents (voir `urlEspaceAgent`) — renommer la clé imposerait une migration
  // des réglages enregistrés pour un gain purement cosmétique.
  //
  // Vide : tout se rabat sur appUrl, cas du déploiement à un seul nom.
  pointageUrl: string;
  // Logo affiché sur la page de connexion, en data URI (data:image/png;base64,…).
  // Vide : l'icône par défaut est utilisée.
  logo: string;
  contactEmail: string; // adresse du service des sports, affichée aux agents
  maxInscriptionsParAgent: number; // 0 = illimité
  validationRequise: boolean; // true : le service arbitre chaque demande
  absencesAvantRelance: number; // seuil de détection des décrocheurs
  // Connexion par lien envoyé sur l'adresse professionnelle, pour les agents
  // qui ne disposent pas d'un poste sur le réseau. Nécessite le SMTP configuré
  // et un miroir d'annuaire synchronisé : seules les adresses connues de l'AD
  // reçoivent un lien.
  lienMagiqueActif: boolean;
  // Formulaire public de demande d'accès, pour les personnes absentes de
  // l'annuaire. Une demande ne crée ni compte ni session : elle attend la
  // validation du service des sports. Sans ce formulaire, ces personnes n'ont
  // d'autre recours que d'écrire au service ; avec, la demande est tracée et
  // se valide d'un clic. Nécessite la connexion par lien, seul moyen de
  // connexion d'un compte hors annuaire.
  demandeAccesActive: boolean;
  // Domaine de messagerie de la collectivité (« chatillon92.fr »).
  //
  // Sert à trancher, sur l'écran d'accès, entre « votre lien est parti » et
  // « vous n'avez pas encore d'accès ». Une adresse de ce domaine reçoit
  // toujours la première réponse, qu'elle existe ou non : sans cela, l'écran
  // permettrait de vérifier depuis Internet si telle personne travaille dans la
  // collectivité, en tapant des adresses jusqu'à ce que la réponse change.
  //
  // Vide : on reprend le domaine de l'adresse de contact du service.
  domaineAgents: string;
  // Rappel envoyé aux inscrits la veille de leur séance. Nécessite le SMTP.
  rappelsActifs: boolean;
  rappelHeuresAvant: number; // fenêtre d'anticipation, en heures
  /**
   * Durée de conservation des inscriptions et des présences, en mois, comptée
   * depuis la fin de la saison. Réglable, et non figée dans le code, parce
   * qu'elle doit pouvoir suivre la durée annoncée dans les mentions
   * d'information : ces deux valeurs qui divergent, c'est exactement la
   * promesse que l'application ne tient pas.
   *
   * 0 = aucune purge. La purge n'est jamais automatique : elle se déclenche à
   * la main depuis Paramètres → Journal.
   */
  conservationMois: number;
};

export const DEFAULT_GENERAL: GeneralSettings = {
  appName: "Bolt",
  appDescription: "Gestion des activités sportives",
  orgName: "Collectivité",
  appUrl: process.env.BOLT_PUBLIC_URL ?? "",
  pointageUrl: process.env.BOLT_POINTAGE_URL ?? "",
  logo: "",
  contactEmail: "",
  maxInscriptionsParAgent: 2,
  validationRequise: true,
  absencesAvantRelance: 3,
  lienMagiqueActif: false,
  demandeAccesActive: false,
  domaineAgents: "",
  rappelsActifs: false,
  rappelHeuresAvant: 24,
  // 14 mois : la durée annoncée sur la fiche d'inscription papier.
  conservationMois: 14,
};

export async function getSetting<T>(key: string): Promise<T | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    update: { value: json },
    create: { key, value: json },
  });
}

export const getLdapSettings = () => getSetting<LdapSettings>("ldap");
export const getSmtpSettings = () => getSetting<SmtpSettings>("smtp");

export async function getGeneralSettings(): Promise<GeneralSettings> {
  const stored = await getSetting<Partial<GeneralSettings>>("general");
  return { ...DEFAULT_GENERAL, ...(stored ?? {}) };
}

/**
 * Nom et description de l'application, pour les métadonnées de page.
 *
 * Tolérant à la panne, contrairement à `getGeneralSettings` : les métadonnées
 * sont calculées à chaque requête, y compris sur la feuille d'émargement
 * publiée sur Internet. Une base momentanément injoignable doit y coûter un
 * titre d'onglet par défaut, pas une page d'erreur.
 */
export async function getIdentiteApp(): Promise<{ nom: string; description: string }> {
  try {
    const g = await getGeneralSettings();
    return { nom: g.appName, description: g.appDescription };
  } catch {
    return { nom: DEFAULT_GENERAL.appName, description: DEFAULT_GENERAL.appDescription };
  }
}

/**
 * Adresse de base des liens envoyés aux agents (lien de connexion, courriel
 * d'activation d'un accès).
 *
 * `appUrl` porte le nom du back-office, qui n'est publié ni au DNS public ni
 * sur le proxy en DMZ. Tant que l'espace agent restait interne, c'était la
 * bonne adresse. Publié sur Internet, ce même lien devient une impasse pour
 * exactement la population qu'il vise : l'agent de terrain qui lit son courriel
 * depuis chez lui obtient un nom qui ne résout pas.
 *
 * Quand PUBLIC_AGENT_ACCESS=1, l'espace agent est servi par le vhost public —
 * le même que la feuille d'émargement. On reprend donc `pointageUrl`, avec
 * `appUrl` en repli pour un déploiement qui n'aurait qu'un seul nom.
 */
export function urlEspaceAgent(g: GeneralSettings): string {
  const base =
    process.env.PUBLIC_AGENT_ACCESS === "1"
      ? g.pointageUrl || g.appUrl
      : g.appUrl;
  return (base || process.env.BOLT_PUBLIC_URL || "").replace(/\/+$/, "");
}

/**
 * Domaine de messagerie de la collectivité, en minuscules et sans « @ ».
 *
 * Déduit de l'adresse de contact du service quand il n'est pas renseigné : une
 * collectivité qui a saisi « sport@ville.fr » a déjà dit ce qu'il fallait
 * savoir, autant ne pas le lui redemander.
 */
export function domaineDesAgents(g: GeneralSettings): string {
  const explicite = g.domaineAgents.trim().replace(/^@/, "").toLowerCase();
  if (explicite) return explicite;
  const contact = g.contactEmail.trim().toLowerCase();
  const arobase = contact.lastIndexOf("@");
  return arobase === -1 ? "" : contact.slice(arobase + 1);
}

/**
 * L'adresse saisie est-elle celle d'un agent de la collectivité ?
 *
 * Sur le seul domaine, sans consulter l'annuaire : c'est précisément ce qui
 * rend la réponse identique pour toutes les adresses du domaine, existantes ou
 * non. Sans domaine configuré, on renvoie faux — l'écran se rabat alors sur la
 * seule question « cette adresse est-elle connue de Bolt ? ».
 */
export function estAdresseDeLaCollectivite(
  g: GeneralSettings,
  email: string,
): boolean {
  const domaine = domaineDesAgents(g);
  if (!domaine) return false;
  return email.trim().toLowerCase().endsWith(`@${domaine}`);
}
