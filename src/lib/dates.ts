import type { Jour } from "@prisma/client";

export const JOURS: Jour[] = [
  "LUNDI",
  "MARDI",
  "MERCREDI",
  "JEUDI",
  "VENDREDI",
  "SAMEDI",
  "DIMANCHE",
];

export const JOUR_LABELS: Record<Jour, string> = {
  LUNDI: "Lundi",
  MARDI: "Mardi",
  MERCREDI: "Mercredi",
  JEUDI: "Jeudi",
  VENDREDI: "Vendredi",
  SAMEDI: "Samedi",
  DIMANCHE: "Dimanche",
};

/** Index JS de getUTCDay() (0 = dimanche) pour chaque jour de la semaine. */
const JOUR_INDEX: Record<Jour, number> = {
  DIMANCHE: 0,
  LUNDI: 1,
  MARDI: 2,
  MERCREDI: 3,
  JEUDI: 4,
  VENDREDI: 5,
  SAMEDI: 6,
};

export function jourIndex(jour: Jour): number {
  return JOUR_INDEX[jour];
}

export function jourDeLaDate(d: Date): Jour {
  return JOURS.find((j) => JOUR_INDEX[j] === d.getUTCDay())!;
}

/**
 * Les dates de séance sont des jours calendaires, pas des instants : elles sont
 * stockées en `date` PostgreSQL et manipulées à minuit UTC. Cela évite le
 * décalage classique où une séance du lundi bascule au dimanche selon le fuseau
 * du serveur ou l'heure d'été.
 */
export function jourUtc(input: Date | string): Date {
  const d = typeof input === "string" ? new Date(`${input}T00:00:00Z`) : input;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Date du jour, ramenée à minuit UTC dans le fuseau de la collectivité. */
export function aujourdhui(): Date {
  const now = new Date();
  const paris = new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // « 2026-09-28 »
  return new Date(`${paris}T00:00:00Z`);
}

export function ajouterJours(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

export function isoDate(d: Date): string {
  return jourUtc(d).toISOString().slice(0, 10);
}

/** Lundi de la semaine contenant `d` (semaine ISO : lundi → dimanche). */
export function debutSemaine(d: Date): Date {
  const j = jourUtc(d);
  return ajouterJours(j, -((j.getUTCDay() + 6) % 7));
}

export function finSemaine(d: Date): Date {
  return ajouterJours(debutSemaine(d), 6);
}

export function debutMois(d: Date): Date {
  const j = jourUtc(d);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), 1));
}

/** Dernier jour du mois calendaire : le « jour 0 » du mois suivant. */
export function finMois(d: Date): Date {
  const j = jourUtc(d);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth() + 1, 0));
}

const FMT_DATE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const FMT_DATE_LONGUE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});

const FMT_MOIS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return FMT_DATE.format(jourUtc(typeof d === "string" ? new Date(d) : d));
}

const FMT_DATE_COMPLETE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const FMT_JOUR_COURT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

/** « mercredi 29 juillet 2026 » — en-tête de planning. */
export function fmtDateComplete(d: Date | string): string {
  return FMT_DATE_COMPLETE.format(jourUtc(typeof d === "string" ? new Date(d) : d));
}

/** « mer. 29/07 » — listes denses où la place manque. */
export function fmtJourCourt(d: Date | string): string {
  return FMT_JOUR_COURT.format(jourUtc(typeof d === "string" ? new Date(d) : d));
}

export function fmtDateLongue(d: Date | string): string {
  return FMT_DATE_LONGUE.format(jourUtc(typeof d === "string" ? new Date(d) : d));
}

export function fmtMois(d: Date | string): string {
  return FMT_MOIS.format(jourUtc(typeof d === "string" ? new Date(d) : d));
}

const FMT_MOIS_COURT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  month: "short",
});

/**
 * « avr. », « mai », « juin », « déc. » — axe des abscisses d'un graphique.
 *
 * Les abréviations françaises sont irrégulières : mars, mai, juin et août ne
 * s'abrègent pas, avril donne « avr. » et non « avri. ». Tronquer à longueur
 * fixe produisait des libellés fautifs ; `Intl` connaît la règle.
 */
export function fmtMoisCourt(d: Date | string): string {
  return FMT_MOIS_COURT.format(jourUtc(typeof d === "string" ? new Date(d) : d));
}

const FMT_HORODATAGE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  dateStyle: "short",
  timeStyle: "short",
});

export function fmtHorodatage(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return FMT_HORODATAGE.format(typeof d === "string" ? new Date(d) : d);
}

/** « 2026-09 » — clé de regroupement mensuel pour les statistiques. */
export function cleMois(d: Date): string {
  return isoDate(d).slice(0, 7);
}

/** « 9h », « 12h15 » — heure à la française, à partir du « HH:MM » stocké. */
export function fmtHeure(h: string): string {
  const [hh, mm] = h.split(":");
  return mm === "00" ? `${Number(hh)}h` : `${Number(hh)}h${mm}`;
}

/** Valide une heure « HH:MM » et la normalise. Renvoie null si invalide. */
export function normaliserHeure(v: string): string | null {
  const m = v.trim().match(/^(\d{1,2})[:hH.](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
