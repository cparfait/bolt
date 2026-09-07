/**
 * Référentiel officiel des services de la collectivité.
 *
 * C'est la liste dont tous les outils doivent parler — pas celle de l'annuaire,
 * qui reflète des OU accumulées sur des années (« Centre de Loisirs Gambetta
 * Elementaire », « Crèche Pierrelais »…) et non des services. Les libellés
 * d'annuaire se RATTACHENT à ces lignes par les regroupements, ils ne les
 * remplacent pas.
 *
 * Dans le code plutôt qu'en base seule : la liste est une donnée de la
 * collectivité, stable, qu'on veut pouvoir reposer d'un geste sur une base
 * neuve ou après un import d'annuaire qui l'aurait noyée. L'ordre est celui de
 * l'organigramme, direction par direction — c'est celui du bon d'inscription.
 */
export const REFERENTIEL_SERVICES: { direction: string; services: string[] }[] = [
  {
    direction: "Cabinet",
    services: ["Cabinet de la Maire", "Communication et Evènementiel", "Prévention et Citoyenneté"],
  },
  {
    direction: "Direction générale",
    services: [
      "Direction générale",
      "Relations avec les habitants et Démocratie locale et Vie associative",
      "Urbanisme et Aménagement et Foncier",
      "Commerce et Attractivité",
      "Direction des Systèmes d'information",
      "Direction des Ressources Humaines",
      "Finances",
      "Processus internes",
      "Déontologie, Laïcité, Gouvernance et Protection des Données",
    ],
  },
  {
    direction: "Services techniques",
    services: [
      "Administration et finances des Services Techniques",
      "Direction des Services Techniques et chargées d'opérations des Services Techniques",
      "Cadre de vie et Transition écologique",
      "Centre Technique municipal",
    ],
  },
  {
    direction: "Administration",
    services: [
      "Achats et Commande Publique",
      "Administration Générale - Affaires juridiques - Assurances - Courrier",
      "Etat-Civil",
    ],
  },
  {
    direction: "Population",
    services: [
      "Police Municipale",
      "Education",
      "Entretien des écoles élémentaires et bâtiments communaux",
      "Cuisine centrale et son évolution",
      "Service Jeunesse",
      "Sports",
      "Petite Enfance",
    ],
  },
  {
    direction: "Culture et solidarités",
    services: [
      "Archives",
      "Action culturelle",
      "Ludo-Médiathèque",
      "Maison des Arts et Maison du Patrimoine",
      "Maison des Enfants",
      "Maison des Seniors",
      "Handicap",
      "CMS",
      "Direction et administration du CCAS et Maintien à domicile",
      "Résidence Monfort",
      "Logement et aides légales",
    ],
  },
];

/** La liste à plat, dans l'ordre d'affichage. */
export const SERVICES_OFFICIELS: string[] = REFERENTIEL_SERVICES.flatMap((d) => d.services);

/**
 * Regroupements de départ, repris tels quels de cybermois (parametrage/
 * chatillon.json) où ils ont été établis en recette : les crèches et les deux
 * relais relèvent de la petite enfance. Rien d'autre n'y avait été décidé — le
 * reste se rattache dans Paramètres → Services, où le moteur propose.
 *
 * La clé d'une règle est insensible aux accents : « Crêche » dans cybermois et
 * « Crèche » dans l'annuaire désignent la même source.
 */
export const REGROUPEMENTS_INITIAUX: { source: string; cible: string }[] = [
  "Crèche Flûte Enchantée",
  "Crèche Ile aux Trésors",
  "Crèche Jardin d'Enfants",
  "Crèche La Cigogne",
  "Crèche Petit Poucet",
  "Crèche Petit Prince",
  "Crèche Pierrelais",
  "Crèche Sablons",
  "Relais Assistance Parentale",
  "Relais Petite Enfance",
].map((source) => ({ source, cible: "Petite Enfance" }));
