-- L'état « excusé » est retiré de l'émargement.
--
-- Il faisait doublon avec l'absence annoncée (table AbsenceAnnoncee), qui porte
-- déjà l'information « cet agent a prévenu » — et qui, elle, est saisie par
-- l'agent lui-même, à l'avance, plutôt que devinée par l'animateur au moment du
-- pointage. Restaient donc trois boutons là où la question n'en compte que
-- deux : la personne est là, ou elle n'est pas là. La feuille continue
-- d'afficher « a prévenu de son absence » à côté du nom.
--
-- Les lignes existantes deviennent des absences : l'agent n'était pas là, c'est
-- le seul fait que l'émargement constate. La nuance n'est pas perdue pour
-- autant lorsqu'elle avait été annoncée.
UPDATE "Presence" SET "etat" = 'ABSENT' WHERE "etat" = 'EXCUSE';

-- PostgreSQL ne sait pas retirer une valeur d'un type énuméré : on recrée le
-- type, on bascule la colonne, puis on remplace l'ancien.
CREATE TYPE "EtatPresence_new" AS ENUM ('PRESENT', 'ABSENT');
ALTER TABLE "Presence" ALTER COLUMN "etat" TYPE "EtatPresence_new"
  USING ("etat"::text::"EtatPresence_new");
DROP TYPE "EtatPresence";
ALTER TYPE "EtatPresence_new" RENAME TO "EtatPresence";
