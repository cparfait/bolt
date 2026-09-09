-- CreateTable
CREATE TABLE "AlerteOuverture" (
    "id" TEXT NOT NULL,
    "creneauId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlerteOuverture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlerteOuverture_userId_idx" ON "AlerteOuverture"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AlerteOuverture_creneauId_userId_key" ON "AlerteOuverture"("creneauId", "userId");

-- AddForeignKey
ALTER TABLE "AlerteOuverture" ADD CONSTRAINT "AlerteOuverture_creneauId_fkey" FOREIGN KEY ("creneauId") REFERENCES "Creneau"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlerteOuverture" ADD CONSTRAINT "AlerteOuverture_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
