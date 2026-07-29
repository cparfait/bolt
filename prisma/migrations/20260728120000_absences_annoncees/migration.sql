-- CreateTable
CREATE TABLE "AbsenceAnnoncee" (
    "id" TEXT NOT NULL,
    "seanceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "motif" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbsenceAnnoncee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AbsenceAnnoncee_userId_idx" ON "AbsenceAnnoncee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AbsenceAnnoncee_seanceId_userId_key" ON "AbsenceAnnoncee"("seanceId", "userId");

-- AddForeignKey
ALTER TABLE "AbsenceAnnoncee" ADD CONSTRAINT "AbsenceAnnoncee_seanceId_fkey" FOREIGN KEY ("seanceId") REFERENCES "Seance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceAnnoncee" ADD CONSTRAINT "AbsenceAnnoncee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

