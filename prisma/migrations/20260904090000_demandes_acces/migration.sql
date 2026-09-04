-- Demandes d'accès déposées depuis Internet par des personnes hors annuaire.
--
-- Une demande ne vaut aucun droit : ni compte, ni session. Le compte « no_ad. »
-- n'est créé qu'à la validation par le service des sports. Cette table est
-- donc une file d'attente, pas un annuaire parallèle.
CREATE TYPE "DemandeAccesStatut" AS ENUM ('EN_ATTENTE', 'VALIDEE', 'REFUSEE');

CREATE TABLE "DemandeAcces" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "service" TEXT,
    "message" TEXT,
    "statut" "DemandeAccesStatut" NOT NULL DEFAULT 'EN_ATTENTE',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidePar" TEXT,
    "decideAt" TIMESTAMP(3),
    "motif" TEXT,
    "userId" TEXT,

    CONSTRAINT "DemandeAcces_pkey" PRIMARY KEY ("id")
);

-- L'écran du service des sports lit la file en attente, du plus ancien au plus
-- récent : c'est le seul accès chaud de cette table.
CREATE INDEX "DemandeAcces_statut_createdAt_idx" ON "DemandeAcces"("statut", "createdAt");

-- Sert au dépôt, pour ne pas empiler plusieurs demandes de la même personne.
CREATE INDEX "DemandeAcces_email_idx" ON "DemandeAcces"("email");
