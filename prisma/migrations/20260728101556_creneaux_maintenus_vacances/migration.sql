-- CreateTable
CREATE TABLE "_CreneauMaintenu" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CreneauMaintenu_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CreneauMaintenu_B_index" ON "_CreneauMaintenu"("B");

-- AddForeignKey
ALTER TABLE "_CreneauMaintenu" ADD CONSTRAINT "_CreneauMaintenu_A_fkey" FOREIGN KEY ("A") REFERENCES "Creneau"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CreneauMaintenu" ADD CONSTRAINT "_CreneauMaintenu_B_fkey" FOREIGN KEY ("B") REFERENCES "Fermeture"("id") ON DELETE CASCADE ON UPDATE CASCADE;
