-- Un créneau peut désormais compter plusieurs animateurs (co-animation, binôme
-- titulaire/remplaçant, intervenants qui se relaient).
--
-- L'ordre des opérations compte : la table de liaison est créée et alimentée
-- AVANT que la colonne « coachId » ne disparaisse. Le script généré par Prisma
-- supprimait la colonne en premier, ce qui aurait perdu tous les rattachements
-- existants.

-- CreateTable
CREATE TABLE "_CreneauAnimateur" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CreneauAnimateur_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CreneauAnimateur_B_index" ON "_CreneauAnimateur"("B");

-- AddForeignKey
ALTER TABLE "_CreneauAnimateur" ADD CONSTRAINT "_CreneauAnimateur_A_fkey" FOREIGN KEY ("A") REFERENCES "Coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CreneauAnimateur" ADD CONSTRAINT "_CreneauAnimateur_B_fkey" FOREIGN KEY ("B") REFERENCES "Creneau"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise des données : l'animateur unique de chaque créneau devient son
-- premier animateur. « A » référence Coach, « B » référence Creneau (Prisma
-- ordonne les colonnes d'une relation implicite par nom de modèle).
INSERT INTO "_CreneauAnimateur" ("A", "B")
SELECT "coachId", "id" FROM "Creneau" WHERE "coachId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Creneau" DROP CONSTRAINT "Creneau_coachId_fkey";

-- DropIndex
DROP INDEX "Creneau_coachId_idx";

-- AlterTable
ALTER TABLE "Creneau" DROP COLUMN "coachId";
