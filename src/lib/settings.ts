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
  // URL des liens d'émargement, quand le pointage est publié sur Internet sous
  // un autre nom que le back-office (ex. https://boltpointage.chatillon92.fr).
  // Vide : les liens d'émargement utilisent appUrl.
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
  // Rappel envoyé aux inscrits la veille de leur séance. Nécessite le SMTP.
  rappelsActifs: boolean;
  rappelHeuresAvant: number; // fenêtre d'anticipation, en heures
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
  rappelsActifs: false,
  rappelHeuresAvant: 24,
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
