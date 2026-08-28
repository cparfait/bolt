import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { getSetting, setSetting } from "./settings";
import { amorceDe } from "./markup";

/**
 * Déclarations et mentions d'information acceptées à l'inscription.
 *
 * Reprises du formulaire papier en vigueur (« QVT — fiche d'inscription »,
 * pages 2 et 3), qui reste le document de référence : les textes par défaut
 * ci-dessous en sont la transcription mot pour mot.
 *
 * Ils sont **modifiables** depuis Paramètres → Déclarations, parce qu'ils
 * bougent au rythme de la DRH et de la DPO, pas à celui des livraisons : une
 * clause à corriger ne doit pas attendre une reconstruction de l'image. La mise
 * en forme passe par le langage restreint de `src/lib/markup.ts` — gras,
 * souligné, puces — et jamais par du HTML.
 *
 * Chaque enregistrement crée une **version archivée** (`TexteLegal`). Sans
 * cela, modifier un texte réécrirait rétroactivement ce que les agents déjà
 * inscrits ont accepté : leur inscription porte un numéro de version, ce
 * numéro doit continuer de désigner le texte qu'ils ont réellement lu.
 */

const CLE_SETTING = "textes";

export type Declaration = {
  /** Identifiant stable : sert de `name` de champ, ne change jamais. */
  cle: string;
  /** Texte au format `src/lib/markup.ts`. */
  texte: string;
};

export type MentionRgpd = { intitule: string; texte: string };

export type TextesLegaux = {
  /** Version en vigueur, enregistrée avec chaque inscription. */
  version: string;
  declarations: Declaration[];
  rgpdPreambule: string;
  mentions: MentionRgpd[];
  rgpdRecours: string;
  rgpdConsentement: string;
};

/** Transcription du formulaire papier, servie tant que rien n'a été modifié. */
export const TEXTES_PAR_DEFAUT: TextesLegaux = {
  version: "2025-2026",
  declarations: [
    {
      cle: "sante",
      texte:
        "**Je certifie** que mon état de santé ne présente aucune contre-indication à la pratique de l'activité sportive à laquelle je me suis inscrit.e et n'avoir aucune pathologie ou antécédent médical incompatible avec ma participation à ladite activité sportive.",
    },
    {
      cle: "arret",
      texte:
        "**Je m'engage** à arrêter immédiatement l'activité concernée si mon état de santé devenait incompatible avec la pratique de l'activité en question.",
    },
    {
      cle: "exactitude",
      texte:
        "**J'atteste** que l'ensemble des renseignements portés sur ce formulaire est exact et à jour et m'engage expressément à signaler toute modification.",
    },
    {
      cle: "responsabilite",
      texte:
        "**Je suis informé.e** que ma responsabilité civile et pénale peut être engagée en cas de fausse déclaration.",
    },
    {
      cle: "accident",
      texte:
        "**Je prends acte** qu'en cas d'accident pendant l'activité à laquelle je m'inscris et participe, celui-ci ne pourra être reconnu en qualité d'accident de travail par la Mairie de Châtillon mon employeur, dès lors que cette activité sportive s'inscrit en dehors de mon temps de travail.",
    },
  ],
  rgpdPreambule:
    "Je reconnais, dans le cadre de ma demande d'inscription à l'activité sportive proposée par la Direction des sports et la Direction des ressources humaines, avoir reçu les informations suivantes :",
  mentions: [
    {
      intitule: "Responsable du traitement",
      texte:
        "les données collectées sur le présent formulaire sont recueillies par la commune de Châtillon (92320), elles sont obligatoires et peuvent être enregistrées dans un fichier informatisé.",
    },
    {
      intitule: "Base légale",
      texte:
        "le traitement de ces données à caractère personnel se fonde sur mon consentement.",
    },
    {
      intitule: "Finalités",
      texte:
        "les données sont collectées afin de pouvoir me contacter, instruire ma demande et gérer mon inscription.",
    },
    {
      intitule: "Durée de conservation",
      texte:
        "les informations communiquées seront conservées pendant 14 mois conformément aux durées réglementairement prévues.",
    },
    {
      intitule: "Destinataires",
      texte:
        "les données transmises sont destinées à la Direction des sports et à la Direction des ressources humaines.",
    },
    {
      intitule: "Utilisation de mes données",
      texte:
        "la Commune s'engage, afin de protéger la confidentialité des données personnelles recueillies, à ce que celles-ci ne soient pas confiées, ni cédées, ni échangées, ni revendues à des tiers (entreprises ou organismes) à des fins commerciales ou de prospection.",
    },
    {
      intitule: "Vos droits",
      texte:
        "conformément au règlement européen n°2016/679/UE sur la protection des données personnelles du 27/04/2016 et à la loi informatique et libertés n°78-17 du 06/01/1978, vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation du traitement, de portabilité et d'opposition pour motifs légitimes, aux données vous concernant ou relatives à la personne dont vous êtes le représentant légal. __À tout moment, vous pouvez retirer votre consentement.__",
    },
    {
      intitule: "Exercice de vos droits",
      texte:
        "ces droits s'exercent sur simple demande adressée par courrier postal à Madame la Maire (Mairie de Châtillon — 1 place de la Libération BP 88, 92322 Châtillon Cedex) ou par courrier électronique au délégué à la protection des données personnelles à l'adresse suivante : dpo@chatillon92.fr.",
    },
  ],
  rgpdRecours:
    "Pour plus d'informations, vous pouvez consulter le site internet de la CNIL — Commission Nationale de l'Informatique et des Libertés (www.cnil.fr) ou celui de la commune de Châtillon (www.ville-chatillon.fr). Si vous estimez, après cette démarche, que vos droits « Informatique et Libertés » ne sont pas respectés, vous avez la possibilité d'introduire une réclamation auprès de la CNIL.",
  rgpdConsentement:
    "Je déclare, en prenant connaissance des informations susmentionnées, accepter de manière libre, spécifique, éclairée et univoque, que la commune de Châtillon (92320) collecte et utilise mes données personnelles pour les finalités déterminées.",
};

/** Nom du champ de formulaire portant le consentement RGPD. */
export const CHAMP_RGPD = "consentementRgpd";

/** Nom du champ de formulaire porté par une déclaration. */
export function champDeclaration(cle: string): string {
  return `declaration_${cle}`;
}

/** Comment désigner une déclaration en une poignée de mots. */
export function libelleDeclaration(d: Declaration): string {
  return amorceDe(d.texte);
}

/**
 * Vérifie que toutes les déclarations sont cochées.
 * Fonction pure, appelée côté serveur : le blocage du bouton dans le
 * navigateur est un confort, pas un contrôle.
 */
export function declarationsCompletes(
  attendues: Declaration[],
  cochees: Iterable<string>,
): boolean {
  const vues = new Set(cochees);
  return attendues.every((d) => vues.has(d.cle));
}

/** Les manquantes, pour un message d'erreur qui dit lesquelles. */
export function declarationsManquantes(
  attendues: Declaration[],
  cochees: Iterable<string>,
): Declaration[] {
  const vues = new Set(cochees);
  return attendues.filter((d) => !vues.has(d.cle));
}

/** Clé d'une déclaration nouvellement ajoutée : aléatoire, donc jamais réutilisée. */
export function nouvelleCle(): string {
  return `d${randomBytes(4).toString("hex")}`;
}

/** Les textes en vigueur, ou ceux du formulaire papier si rien n'a été modifié. */
export async function getTextesLegaux(): Promise<TextesLegaux> {
  const stored = await getSetting<TextesLegaux>(CLE_SETTING);
  return stored ? { ...TEXTES_PAR_DEFAUT, ...stored } : TEXTES_PAR_DEFAUT;
}

/**
 * Les textes d'une version passée, tels qu'un agent les a acceptés.
 * `null` si la version est antérieure à l'archivage — auquel cas seuls les
 * textes par défaut peuvent en témoigner.
 */
export async function getTextesVersion(version: string): Promise<TextesLegaux | null> {
  if (version === TEXTES_PAR_DEFAUT.version) {
    const archive = await prisma.texteLegal.findUnique({ where: { version } });
    return archive ? (JSON.parse(archive.contenu) as TextesLegaux) : TEXTES_PAR_DEFAUT;
  }
  const archive = await prisma.texteLegal.findUnique({ where: { version } });
  return archive ? (JSON.parse(archive.contenu) as TextesLegaux) : null;
}

/**
 * Numéro de la prochaine version : la date du jour, suffixée si la journée en
 * a déjà vu une. Lisible dans un registre des traitements, et ordonnable.
 */
export function prochaineVersion(jour: string, dejaPrises: Iterable<string>): string {
  const prises = new Set(dejaPrises);
  if (!prises.has(jour)) return jour;
  for (let n = 2; ; n += 1) {
    const candidat = `${jour}-${n}`;
    if (!prises.has(candidat)) return candidat;
  }
}

/** Vrai si les textes diffèrent, version mise à part. */
export function textesModifies(avant: TextesLegaux, apres: TextesLegaux): boolean {
  // La version change à chaque publication : la comparer ferait voir une
  // modification là où il n'y en a pas.
  const sansVersion = (t: TextesLegaux) =>
    JSON.stringify({
      declarations: t.declarations,
      rgpdPreambule: t.rgpdPreambule,
      mentions: t.mentions,
      rgpdRecours: t.rgpdRecours,
      rgpdConsentement: t.rgpdConsentement,
    });
  return sansVersion(avant) !== sansVersion(apres);
}

/**
 * Publie de nouveaux textes : archive la version qui sort, puis met la
 * nouvelle en vigueur. Sans modification réelle, ne fait rien — pour qu'un
 * enregistrement machinal ne crée pas une version fantôme.
 */
export async function enregistrerTextesLegaux(
  proposes: Omit<TextesLegaux, "version">,
  auteur: string,
): Promise<{ textes: TextesLegaux; publiee: boolean }> {
  const actuels = await getTextesLegaux();
  const candidat: TextesLegaux = { ...proposes, version: actuels.version };
  if (!textesModifies(actuels, candidat)) return { textes: actuels, publiee: false };

  // La version qui sort est archivée si elle ne l'était pas encore : sans cela,
  // la toute première modification effacerait le texte accepté par les agents
  // inscrits avant elle.
  await prisma.texteLegal.upsert({
    where: { version: actuels.version },
    update: {},
    create: {
      version: actuels.version,
      contenu: JSON.stringify(actuels),
      creePar: "version initiale",
    },
  });

  const jour = new Date().toISOString().slice(0, 10);
  const prises = (await prisma.texteLegal.findMany({ select: { version: true } })).map(
    (t) => t.version,
  );
  const version = prochaineVersion(jour, [...prises, actuels.version]);

  const nouveaux: TextesLegaux = { ...proposes, version };
  await prisma.texteLegal.create({
    data: { version, contenu: JSON.stringify(nouveaux), creePar: auteur },
  });
  await setSetting(CLE_SETTING, nouveaux);
  return { textes: nouveaux, publiee: true };
}
