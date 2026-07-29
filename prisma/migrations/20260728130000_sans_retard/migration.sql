-- L'état « retard » est retiré : il n'apportait rien au suivi de fréquentation
-- et alourdissait la saisie de l'animateur. Un agent arrivé en retard était
-- présent — les lignes existantes sont donc reclassées, pas supprimées.
UPDATE "Presence" SET "etat" = 'PRESENT' WHERE "etat" = 'RETARD';

-- PostgreSQL ne sait pas retirer une valeur d'un type énuméré : on recrée le
-- type, on bascule la colonne, puis on remplace l'ancien.
CREATE TYPE "EtatPresence_new" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSE');
ALTER TABLE "Presence" ALTER COLUMN "etat" TYPE "EtatPresence_new"
  USING ("etat"::text::"EtatPresence_new");
DROP TYPE "EtatPresence";
ALTER TYPE "EtatPresence_new" RENAME TO "EtatPresence";
