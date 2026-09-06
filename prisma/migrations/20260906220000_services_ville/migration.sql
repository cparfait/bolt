-- Référentiel des services de la collectivité.
--
-- Proposé en liste sur le bon d'inscription, pour les personnes absentes de
-- l'annuaire. Le rattachement d'un compte AD, lui, reste lu dans l'annuaire et
-- réécrit à chaque synchronisation : ce référentiel ne le concerne pas.
--
-- Le compte conserve le libellé en clair (`User.service`) plutôt qu'une clé
-- étrangère, comme les lieux sur les créneaux : les exports et les saisons
-- passées gardent le service tel qu'il était, et retirer un service de la liste
-- n'efface pas l'historique.
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- L'unicité porte le référentiel : c'est elle qui empêche « DSI » et « DSI »
-- de coexister, et elle qui fait échouer proprement un import répété.
CREATE UNIQUE INDEX "Service_nom_key" ON "Service"("nom");
