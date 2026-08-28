-- Une activité peut se pratiquer sans émargement : musculation en libre accès,
-- salle ouverte sans animateur. Ses séances passées comptaient jusqu'ici comme
-- des feuilles jamais transmises, ce qui effondrait le taux d'émargement de la
-- collectivité et affichait l'activité à 0 % de présence au bilan.
--
-- Vrai par défaut : toutes les activités existantes sont émargées, c'est bien
-- l'état d'aujourd'hui. Le service des sports décoche au cas par cas.
ALTER TABLE "Activite" ADD COLUMN "suiviPresence" BOOLEAN NOT NULL DEFAULT true;
