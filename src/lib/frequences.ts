/**
 * Rythmes proposés pour l'avis « des demandes attendent ».
 *
 * Les créneaux sont des heures de bureau : un avis à 3 h du matin est lu à 9 h
 * de toute façon, et il aura seulement l'air d'une alerte.
 */
export const FREQUENCES_AVIS = {
  DEUX_HEURES: { label: "Toutes les deux heures", heures: [8, 10, 12, 14, 16, 18], jour: null },
  QUATRE_JOUR: { label: "Quatre fois par jour", heures: [9, 12, 14, 16], jour: null },
  DEUX_JOUR: { label: "Deux fois par jour", heures: [9, 14], jour: null },
  UNE_JOUR: { label: "Une fois par jour", heures: [9], jour: null },
  HEBDO: { label: "Une fois par semaine", heures: [9], jour: 1 },
} as const;

export type FrequenceAvis = keyof typeof FREQUENCES_AVIS;
