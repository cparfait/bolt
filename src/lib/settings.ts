import { prisma } from "./db";
import type { FrequenceAvis } from "./frequences";

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
  // Deux logos, en data URI (data:image/png;base64,…), empilés sur les écrans
  // d'accueil : celui de la collectivité au-dessus, celui de l'opération en
  // cours en dessous.
  //
  // La distinction existe parce que l'un ne bouge jamais et l'autre change
  // plusieurs fois par an — Halloween, Noël, un défi de rentrée. Avec un seul
  // champ, habiller l'application pour une saison obligeait à effacer
  // l'identité de la ville, puis à la remettre ; en pratique, on ne la
  // remettait pas.
  //
  // `logo` garde son nom malgré son nouveau rôle : le renommer imposerait une
  // migration des réglages enregistrés pour un gain cosmétique, et surtout
  // ferait disparaître le logo en place chez ceux qui l'ont déjà posé.
  logoVille: string;
  /** Logo de l'opération en cours. Vide : rien ne s'affiche à cette place. */
  logo: string;
  contactEmail: string; // adresse du service des sports, affichée aux agents
  /**
   * Créneaux qu'un agent peut occuper en même temps sur la saison. 0 = illimité.
   *
   * Le décompte porte sur les créneaux et non sur les activités : deux séances
   * de musculation par semaine, c'est deux places prises sur le planning, deux
   * salles à dimensionner et deux collègues qui n'auront pas ces créneaux —
   * quand bien même l'agent ne pratique qu'un seul sport. Compter par activité
   * revenait à laisser un agent occuper tout un planning sans consommer son
   * quota.
   *
   * La liste d'attente n'entre pas dans ce compte : voir
   * `maxListeAttenteParAgent`.
   */
  maxInscriptionsParAgent: number;
  /**
   * Créneaux sur lesquels un agent peut attendre en plus de ses inscriptions.
   * 0 = illimité.
   *
   * Compté à part, parce qu'attendre n'est pas pratiquer : un agent limité à
   * une activité et dont le premier choix est complet doit pouvoir prendre ce
   * qui reste ET rester dans la file de ce qu'il voulait. Tant que la file lui
   * coûtait une place de son quota, il devait choisir entre faire du sport
   * cette saison et espérer la bonne activité — et le service des sports
   * perdait la seule information qui lui dit quel créneau ouvrir en second.
   */
  maxListeAttenteParAgent: number;
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
  /**
   * Rythme des avis envoyés au service des sports quand des demandes attendent.
   *
   * Un courriel par dépôt paraissait la bonne idée : il l'est tant qu'il y a
   * deux demandes par mois, et il devient du bruit à la rentrée — un bruit
   * qu'on finit par filtrer, ce qui coûte plus cher que de l'avoir manqué.
   *
   * Aucun avis ne part si la file est vide : ce n'est pas un rapport
   * périodique, c'est un rappel de ce qui attend.
   */
  frequenceAvisDemandes: FrequenceAvis;
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
  // Rappel envoyé aux inscrits avant leur séance. Nécessite le SMTP.
  rappelsActifs: boolean;
  /**
   * Quand part le rappel : tant de jours avant la séance, à telle heure.
   *
   * Le réglage disait auparavant « 24 heures avant », et c'était une fenêtre,
   * pas un rendez-vous : la séance devenait rappelable dès qu'elle entrait dans
   * les vingt-quatre heures, donc dès minuit passé — le courriel arrivait au
   * milieu de la nuit, en tête d'une boîte que l'agent ouvrirait huit heures
   * plus tard, sous vingt autres messages.
   *
   * Un jour et une heure disent la même chose sans l'ambiguïté : « la veille à
   * midi » se vérifie d'un coup d'œil, se règle sans calcul, et tombe sur la
   * pause déjeuner — le moment où l'on décide si l'on ira demain.
   *
   * 0 jour = le jour même. L'heure est celle de la collectivité (Europe/Paris),
   * au format « HH:MM » ; la précision réelle est celle du battement de
   * l'ordonnanceur, cinq minutes.
   */
  rappelJoursAvant: number;
  rappelHeure: string;
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
  logoVille: "",
  logo: "",
  contactEmail: "",
  maxInscriptionsParAgent: 1,
  maxListeAttenteParAgent: 1,
  validationRequise: true,
  absencesAvantRelance: 3,
  lienMagiqueActif: false,
  demandeAccesActive: false,
  frequenceAvisDemandes: "QUATRE_JOUR",
  domaineAgents: "",
  rappelsActifs: false,
  rappelJoursAvant: 1,
  rappelHeure: "12:00",
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
  const stored = await getSetting<Reglages>("general");
  const g = { ...DEFAULT_GENERAL, ...(stored ?? {}) };

  // Réglage d'avant le passage à « tant de jours avant, à telle heure » : une
  // fenêtre en heures. On la convertit plutôt que de la perdre — une
  // collectivité qui avait réglé 48 h voulait deux jours d'avance, et se
  // retrouverait sinon rappelée la veille sans l'avoir demandé. L'heure
  // d'envoi, elle, n'a pas d'équivalent à reprendre : il n'y en avait pas.
  if (stored?.rappelJoursAvant === undefined && typeof stored?.rappelHeuresAvant === "number") {
    g.rappelJoursAvant = Math.max(0, Math.min(7, Math.round(stored.rappelHeuresAvant / 24)));
  }
  return g;
}

/** Ce qu'on peut lire en base : les réglages du jour, et ceux d'hier. */
type Reglages = Partial<GeneralSettings> & {
  /** @deprecated remplacé par `rappelJoursAvant` + `rappelHeure`. */
  rappelHeuresAvant?: number;
};

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
