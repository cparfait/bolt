-- CreateTable
CREATE TABLE "ParticipationPonctuelle" (
    "id" TEXT NOT NULL,
    "seanceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ajoutePar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParticipationPonctuelle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParticipationPonctuelle_userId_idx" ON "ParticipationPonctuelle"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipationPonctuelle_seanceId_userId_key" ON "ParticipationPonctuelle"("seanceId", "userId");

-- AddForeignKey
ALTER TABLE "ParticipationPonctuelle" ADD CONSTRAINT "ParticipationPonctuelle_seanceId_fkey" FOREIGN KEY ("seanceId") REFERENCES "Seance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipationPonctuelle" ADD CONSTRAINT "ParticipationPonctuelle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
