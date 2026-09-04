import type {
  CoachAcces,
  EtatPresence,
  InscriptionStatut,
  Role,
  SeanceStatut,
} from "@prisma/client";

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrateur",
  GESTIONNAIRE: "Service des sports",
  COACH: "Animateur",
  AGENT: "Agent",
};

export const ETAT_COURT: Record<EtatPresence, string> = {
  PRESENT: "Présent(e)",
  ABSENT: "Absent(e)",
};

export const ETAT_COLORS: Record<EtatPresence, string> = {
  PRESENT: "bg-emerald-100 text-emerald-700 ring-emerald-500/20",
  ABSENT: "bg-red-100 text-red-700 ring-red-500/20",
};

export const SEANCE_STATUT_LABELS: Record<SeanceStatut, string> = {
  PLANIFIEE: "Planifiée",
  FAITE: "Émargée",
  ANNULEE: "Annulée",
};

export const SEANCE_STATUT_COLORS: Record<SeanceStatut, string> = {
  PLANIFIEE: "bg-slate-100 text-slate-600 ring-slate-500/20",
  FAITE: "bg-emerald-100 text-emerald-700 ring-emerald-500/20",
  ANNULEE: "bg-red-100 text-red-700 ring-red-500/20",
};

export const INSCRIPTION_STATUT_LABELS: Record<InscriptionStatut, string> = {
  EN_ATTENTE: "En attente",
  VALIDEE: "Inscrit",
  LISTE_ATTENTE: "Liste d'attente",
  REFUSEE: "Refusée",
  DESISTEE: "Désisté",
};

export const INSCRIPTION_STATUT_COLORS: Record<InscriptionStatut, string> = {
  EN_ATTENTE: "bg-amber-100 text-amber-700 ring-amber-500/20",
  VALIDEE: "bg-emerald-100 text-emerald-700 ring-emerald-500/20",
  LISTE_ATTENTE: "bg-blue-100 text-blue-700 ring-blue-500/20",
  REFUSEE: "bg-red-100 text-red-700 ring-red-500/20",
  DESISTEE: "bg-slate-100 text-slate-500 ring-slate-500/20",
};

export const COACH_ACCES_LABELS: Record<CoachAcces, string> = {
  AD: "Compte Active Directory",
  LOCAL: "Identifiant local",
  LIEN: "Lien sécurisé (sans compte)",
};

export const COACH_ACCES_AIDE: Record<CoachAcces, string> = {
  AD: "L'animateur est agent de la collectivité : il se connecte avec son identifiant Windows habituel.",
  LOCAL:
    "Un identifiant et un mot de passe gérés dans l'application. À réserver aux animateurs qui accèdent depuis le réseau.",
  LIEN: "Aucun compte : un lien personnel + un code à 6 chiffres, utilisable depuis n'importe où. Recommandé pour les prestataires extérieurs.",
};

/** Palette proposée pour les activités (badges, graphiques). */
export const COULEURS_ACTIVITE = [
  "#4f46e5", // indigo
  "#0891b2", // cyan
  "#059669", // emerald
  "#d97706", // amber
  "#db2777", // pink
  "#7c3aed", // violet
  "#dc2626", // red
  "#0284c7", // sky
] as const;

/**
 * Prénom extrait d'un nom affiché, pour les salutations.
 *
 * L'Active Directory de la collectivité présente « PARFAIT Christophe » : nom de
 * famille d'abord, en capitales. Prendre le premier mot donnait donc
 * « Bonjour PARFAIT » sur le tableau de bord et en tête de chaque courriel.
 *
 * La règle retenue ne suppose pas l'ordre des mots, mais s'appuie sur la casse,
 * qui est le vrai signal : **le premier mot qui n'est pas tout en capitales**.
 * Elle traite « PARFAIT Christophe » comme « Christine BOULIOL », et laisse les
 * particules à leur place — « DE LA TOUR Pierre » donne bien « Pierre ». Si tout
 * est en capitales, ou tout en minuscules, on retombe sur le premier mot : sans
 * signal, il n'y a rien à deviner.
 */
export function prenomDe(nomAffiche: string): string {
  const mots = nomAffiche.trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return nomAffiche.trim();
  const enCapitales = (m: string) =>
    m === m.toLocaleUpperCase("fr") && m !== m.toLocaleLowerCase("fr");
  return mots.find((m) => !enCapitales(m)) ?? mots[0];
}

/**
 * Nom tel qu'on l'écrit en tête d'un courriel : « Prénom Nom ».
 *
 * `prenomDe` suffit à l'écran, où « Bonjour Christophe » est le ton juste. Dans
 * un courriel, il faut le nom entier — et surtout dans le bon ordre.
 *
 * L'annuaire rend « PARFAIT Christophe » : patronyme en capitales d'abord,
 * convention d'affichage d'un AD, illisible en salutation. On repère les mots
 * en capitales — le patronyme — et on les renvoie après les autres, en
 * capitale initiale seulement.
 *
 * Quand rien ne distingue les mots — « Chloé Parfait », saisi à la main —, on
 * ne devine pas : l'ordre saisi est conservé. C'est pourquoi le formulaire de
 * demande d'accès réclame « prénom puis nom » plutôt que l'inverse.
 */
export function nomPourSalutation(nomAffiche: string): string {
  const mots = nomAffiche.trim().split(/\s+/).filter(Boolean);
  if (mots.length < 2) return nomAffiche.trim();

  const enCapitales = (m: string) =>
    m === m.toLocaleUpperCase("fr") && m !== m.toLocaleLowerCase("fr");

  const patronyme = mots.filter(enCapitales);
  const prenoms = mots.filter((m) => !enCapitales(m));
  if (patronyme.length === 0 || prenoms.length === 0) return mots.join(" ");

  const capitaliser = (m: string) =>
    m
      .toLocaleLowerCase("fr")
      .replace(/(^|[-'’])(\p{L})/gu, (_, s, l) => s + l.toLocaleUpperCase("fr"));

  return [...prenoms, ...patronyme.map(capitaliser)].join(" ");
}

export function pluriel(n: number, singulier: string, plurielMot?: string): string {
  return n > 1 ? (plurielMot ?? `${singulier}s`) : singulier;
}
