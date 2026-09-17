-- CreateTable
CREATE TABLE "AvisAbsences" (
    "id" TEXT NOT NULL,
    "inscriptionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seanceId" TEXT NOT NULL,
    "absences" INTEGER NOT NULL,
    "envoyeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erreur" TEXT,

    CONSTRAINT "AvisAbsences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AvisAbsences_inscriptionId_idx" ON "AvisAbsences"("inscriptionId");

-- CreateIndex
CREATE INDEX "AvisAbsences_userId_idx" ON "AvisAbsences"("userId");

-- AddForeignKey
ALTER TABLE "AvisAbsences" ADD CONSTRAINT "AvisAbsences_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "Inscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvisAbsences" ADD CONSTRAINT "AvisAbsences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvisAbsences" ADD CONSTRAINT "AvisAbsences_seanceId_fkey" FOREIGN KEY ("seanceId") REFERENCES "Seance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
