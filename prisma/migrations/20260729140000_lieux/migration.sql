-- Référentiel des lieux de pratique.
--
-- Le lieu était un champ libre sur le créneau : « Gymnase municipal », « gymnase
-- municipal », « Gymnase Municipal - salle 2 » désignaient la même salle sans
-- qu'aucun regroupement ne soit possible. Il se saisit désormais une fois dans
-- les paramètres et se choisit dans une liste.
CREATE TABLE "Lieu" (
  "id"        TEXT NOT NULL,
  "nom"       TEXT NOT NULL,
  "adresse"   TEXT,
  "notes"     TEXT,
  "actif"     BOOLEAN NOT NULL DEFAULT true,
  "ordre"     INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Lieu_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Lieu_nom_key" ON "Lieu"("nom");

-- Reprise de l'existant : chaque libellé déjà saisi devient un lieu, pour que
-- les créneaux en place restent cohérents avec la liste dès la mise à jour.
-- `gen_random_uuid()` est disponible en standard depuis PostgreSQL 13.
INSERT INTO "Lieu" ("id", "nom", "ordre")
SELECT gen_random_uuid()::text, TRIM("lieu"), 0
FROM (
  SELECT DISTINCT TRIM("lieu") AS "lieu"
  FROM "Creneau"
  WHERE "lieu" IS NOT NULL AND TRIM("lieu") <> ''
) AS existants;
