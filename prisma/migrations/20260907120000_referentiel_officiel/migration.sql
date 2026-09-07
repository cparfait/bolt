-- Le référentiel des services de la collectivité, posé une fois pour toutes.
--
-- Jusqu'ici il se remplissait depuis l'annuaire, et l'annuaire ne liste pas des
-- services : il liste des OU accumulées sur des années — « Centre de Loisirs
-- Gambetta Elementaire », « Crèche Pierrelais », « Jeunesse - Kid Club ». Cent
-- lignes dont aucune n'est un service au sens de l'organigramme, proposées à la
-- saisie et mêlées aux vraies. D'où cette migration : le référentiel devient la
-- liste que la collectivité reconnaît, l'annuaire n'alimente plus que les
-- libellés À RATTACHER.
--
-- La liste s'administre ensuite normalement — ajouter, renommer, retirer,
-- supprimer. Cette migration ne fait que lui donner son point de départ, et ne
-- s'exécute qu'une fois.

-- 1. Tout ce qui est là vient de l'annuaire : on le retire de la liste proposée
--    sans rien supprimer, des fiches portent ces libellés.
UPDATE "Service" SET "actif" = false;

-- 2. Le référentiel officiel, dans l'ordre de l'organigramme. Un service qui
--    existait déjà sous ce nom est réactivé et remis à sa place.
INSERT INTO "Service" ("id", "nom", "actif", "ordre") VALUES
  (gen_random_uuid()::text, 'Cabinet de la Maire', true, 0),
  (gen_random_uuid()::text, 'Communication et Evènementiel', true, 1),
  (gen_random_uuid()::text, 'Prévention et Citoyenneté', true, 2),
  (gen_random_uuid()::text, 'Direction générale', true, 3),
  (gen_random_uuid()::text, 'Relations avec les habitants et Démocratie locale et Vie associative', true, 4),
  (gen_random_uuid()::text, 'Urbanisme et Aménagement et Foncier', true, 5),
  (gen_random_uuid()::text, 'Commerce et Attractivité', true, 6),
  (gen_random_uuid()::text, 'Direction des Systèmes d''information', true, 7),
  (gen_random_uuid()::text, 'Direction des Ressources Humaines', true, 8),
  (gen_random_uuid()::text, 'Finances', true, 9),
  (gen_random_uuid()::text, 'Processus internes', true, 10),
  (gen_random_uuid()::text, 'Déontologie, Laïcité, Gouvernance et Protection des Données', true, 11),
  (gen_random_uuid()::text, 'Administration et finances des Services Techniques', true, 12),
  (gen_random_uuid()::text, 'Direction des Services Techniques et chargées d''opérations des Services Techniques', true, 13),
  (gen_random_uuid()::text, 'Cadre de vie et Transition écologique', true, 14),
  (gen_random_uuid()::text, 'Centre Technique municipal', true, 15),
  (gen_random_uuid()::text, 'Achats et Commande Publique', true, 16),
  (gen_random_uuid()::text, 'Administration Générale -Affaires juridiques-Assurances-Courrier', true, 17),
  (gen_random_uuid()::text, 'Etat-Civil', true, 18),
  (gen_random_uuid()::text, 'Police Municipale', true, 19),
  (gen_random_uuid()::text, 'Education', true, 20),
  (gen_random_uuid()::text, 'Entretien des écoles élémentaires et bâtiments communaux', true, 21),
  (gen_random_uuid()::text, 'Cuisine centrale et son évolution', true, 22),
  (gen_random_uuid()::text, 'Service Jeunesse', true, 23),
  (gen_random_uuid()::text, 'Sports', true, 24),
  (gen_random_uuid()::text, 'Petite Enfance', true, 25),
  (gen_random_uuid()::text, 'Archives', true, 26),
  (gen_random_uuid()::text, 'Action culturelle', true, 27),
  (gen_random_uuid()::text, 'Ludo-Médiathèque', true, 28),
  (gen_random_uuid()::text, 'Maison des Arts et Maison du Patrimoine', true, 29),
  (gen_random_uuid()::text, 'Maison des Enfants', true, 30),
  (gen_random_uuid()::text, 'Maison des Seniors', true, 31),
  (gen_random_uuid()::text, 'Handicap', true, 32),
  (gen_random_uuid()::text, 'CMS', true, 33),
  (gen_random_uuid()::text, 'Direction et administation du CCAS et Maintien à domicile', true, 34),
  (gen_random_uuid()::text, 'Résidence Monfort', true, 35),
  (gen_random_uuid()::text, 'Logement et aides légales', true, 36)
ON CONFLICT ("nom") DO UPDATE SET "actif" = true, "ordre" = EXCLUDED."ordre";

-- 3. Les regroupements « ce libellé d'annuaire désigne ce service », établis à
--    la main dans cybermois sur l'effectif réel de la collectivité. Ils sont la
--    moitié utile du travail : sans eux, les quatre-vingt-dix libellés de l'AD
--    seraient tous à rattacher un par un.
--
--    Une règle déjà posée sur la même source n'est pas écrasée : elle vient
--    d'une décision prise dans l'application, et cette migration n'a pas à la
--    défaire.
INSERT INTO "RegroupementService" ("source", "cible") VALUES
  ('Marchés Publics', 'Achats et Commande Publique'),
  ('Administration Générale', 'Administration Générale -Affaires juridiques-Assurances-Courrier'),
  ('Courrier', 'Administration Générale -Affaires juridiques-Assurances-Courrier'),
  ('Cabinet de Madame la Maire', 'Cabinet de la Maire'),
  ('CTM', 'Centre Technique municipal'),
  ('Animation Commerciale et Attractivité', 'Commerce et Attractivité'),
  ('Communication', 'Communication et Evènementiel'),
  ('Entretien, Restauration et Séniors', 'Communication et Evènementiel'),
  ('Espace Maison Blanche', 'Communication et Evènementiel'),
  ('Evènementiel', 'Communication et Evènementiel'),
  ('Imprimerie', 'Communication et Evènementiel'),
  ('Cuisine Centrale', 'Cuisine centrale et son évolution'),
  ('Direction Entretien et Restauration', 'Cuisine centrale et son évolution'),
  ('Ressources Humaines', 'Direction des Ressources Humaines'),
  ('Ressources Humaines Carrières', 'Direction des Ressources Humaines'),
  ('Ressources Humaines Formation', 'Direction des Ressources Humaines'),
  ('CCAS', 'Direction et administation du CCAS et Maintien à domicile'),
  ('Direction Générale des Services', 'Direction générale'),
  ('DPO', 'Déontologie, Laïcité, Gouvernance et Protection des Données'),
  ('Centre de Loisirs Arc-en-Ciel Maternelle', 'Education'),
  ('Centre de Loisirs du Parc Maternelle', 'Education'),
  ('Centre de Loisirs Gambetta Elementaire', 'Education'),
  ('Centre de Loisirs Gay Lussac Maternelle', 'Education'),
  ('Centre de Loisirs Jean Jaures Maternelle', 'Education'),
  ('Centre de Loisirs Joliot Curie Elementaire', 'Education'),
  ('Centre de Loisirs Joliot Curie Maternelle', 'Education'),
  ('Centre de Loisirs Jules Verne Elementaire', 'Education'),
  ('Centre de Loisirs Langevin Wallon Elementaire', 'Education'),
  ('Centre de Loisirs Langevin Wallon Maternelle', 'Education'),
  ('Centre de Loisirs Marcel Doret Elementaire', 'Education'),
  ('Centre de Loisirs Sablons Elementaire', 'Education'),
  ('Centre de Loisirs Sablons Maternelle', 'Education'),
  ('Education - Centre de Loisirs Sablons Maternelle', 'Education'),
  ('Education --Centre de Loisirs Joliot Curie Maternelle', 'Education'),
  ('Entretien Maternelles', 'Education'),
  ('Accueils Ecoles', 'Entretien des écoles élémentaires et bâtiments communaux'),
  ('Entretien', 'Entretien des écoles élémentaires et bâtiments communaux'),
  ('Entretien Elementaires', 'Entretien des écoles élémentaires et bâtiments communaux'),
  ('Cimetière', 'Etat-Civil'),
  ('Population & Citoyenneté', 'Etat-Civil'),
  ('Population et Citoyenneté', 'Etat-Civil'),
  ('Accessibilité et Handicap', 'Handicap'),
  ('Logement', 'Logement et aides légales'),
  ('Ludothèque', 'Ludo-Médiathèque'),
  ('Médiathèque', 'Ludo-Médiathèque'),
  ('Maison des Arts', 'Maison des Arts et Maison du Patrimoine'),
  ('Maison du Patrimoine', 'Maison des Arts et Maison du Patrimoine'),
  ('Crêche Flûte Enchantée', 'Petite Enfance'),
  ('Crêche Ile aux Trésors', 'Petite Enfance'),
  ('Crêche Jardin d''Enfants', 'Petite Enfance'),
  ('Crêche La Cigogne', 'Petite Enfance'),
  ('Crêche Petit Poucet', 'Petite Enfance'),
  ('Crêche Petit Prince', 'Petite Enfance'),
  ('Crêche Pierrelais', 'Petite Enfance'),
  ('Crêche Sablons', 'Petite Enfance'),
  ('Relais Assistance Parentale', 'Petite Enfance'),
  ('Relais Petite Enfance', 'Petite Enfance'),
  ('Prévention et Citoyenneté - Espace Gisèle Halimi', 'Prévention et Citoyenneté'),
  ('Direction Relation avec les Habitants et Démocratie Locale', 'Relations avec les habitants et Démocratie locale et Vie associative'),
  ('Vie Associative', 'Relations avec les habitants et Démocratie locale et Vie associative'),
  ('Jeunesse', 'Service Jeunesse'),
  ('Jeunesse - BIJ', 'Service Jeunesse'),
  ('Jeunesse - Club 6-12', 'Service Jeunesse'),
  ('Jeunesse - Kid Club', 'Service Jeunesse'),
  ('Jeunesse - Le Chat', 'Service Jeunesse'),
  ('Urbanisme et Aménagement', 'Urbanisme et Aménagement et Foncier')
ON CONFLICT ("source") DO NOTHING;
