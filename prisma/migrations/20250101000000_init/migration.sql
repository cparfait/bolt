-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'GESTIONNAIRE', 'COACH', 'AGENT');

-- CreateEnum
CREATE TYPE "CoachAcces" AS ENUM ('AD', 'LOCAL', 'LIEN');

-- CreateEnum
CREATE TYPE "Jour" AS ENUM ('LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE');

-- CreateEnum
CREATE TYPE "SeanceStatut" AS ENUM ('PLANIFIEE', 'FAITE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "EtatPresence" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSE', 'RETARD');

-- CreateEnum
CREATE TYPE "InscriptionStatut" AS ENUM ('EN_ATTENTE', 'VALIDEE', 'LISTE_ATTENTE', 'REFUSEE', 'DESISTEE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "role" "Role" NOT NULL DEFAULT 'AGENT',
    "isLocal" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "direction" TEXT,
    "service" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coach" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "email" TEXT,
    "telephone" TEXT,
    "organisme" TEXT,
    "acces" "CoachAcces" NOT NULL DEFAULT 'LIEN',
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "userId" TEXT,
    "token" TEXT,
    "pinHash" TEXT,
    "tokenCreatedAt" TIMESTAMP(3),
    "tokenExpiresAt" TIMESTAMP(3),
    "lastAccessAt" TIMESTAMP(3),
    "lastAccessIp" TEXT,
    "pinFailedCount" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Saison" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "debut" DATE NOT NULL,
    "fin" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Saison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fermeture" (
    "id" TEXT NOT NULL,
    "saisonId" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "debut" DATE NOT NULL,
    "fin" DATE NOT NULL,

    CONSTRAINT "Fermeture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activite" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT,
    "couleur" TEXT NOT NULL DEFAULT '#4f46e5',
    "icone" TEXT NOT NULL DEFAULT 'Activity',
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creneau" (
    "id" TEXT NOT NULL,
    "saisonId" TEXT NOT NULL,
    "activiteId" TEXT NOT NULL,
    "coachId" TEXT,
    "jour" "Jour" NOT NULL,
    "heureDebut" TEXT NOT NULL,
    "heureFin" TEXT NOT NULL,
    "lieu" TEXT,
    "capacite" INTEGER NOT NULL DEFAULT 20,
    "ouvertInscription" BOOLEAN NOT NULL DEFAULT true,
    "dateDebut" DATE,
    "dateFin" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creneau_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seance" (
    "id" TEXT NOT NULL,
    "creneauId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "statut" "SeanceStatut" NOT NULL DEFAULT 'PLANIFIEE',
    "motifAnnulation" TEXT,
    "commentaire" TEXT,
    "clotureeAt" TIMESTAMP(3),
    "clotureePar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Seance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Presence" (
    "id" TEXT NOT NULL,
    "seanceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inscriptionId" TEXT,
    "etat" "EtatPresence" NOT NULL,
    "commentaire" TEXT,
    "saisiAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saisiPar" TEXT,

    CONSTRAINT "Presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inscription" (
    "id" TEXT NOT NULL,
    "creneauId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "statut" "InscriptionStatut" NOT NULL DEFAULT 'EN_ATTENTE',
    "rang" INTEGER,
    "demandeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decisionAt" TIMESTAMP(3),
    "decidePar" TEXT,
    "motif" TEXT,
    "commentaire" TEXT,

    CONSTRAINT "Inscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AdAccount" (
    "samAccountName" TEXT NOT NULL,
    "displayName" TEXT,
    "email" TEXT,
    "dn" TEXT NOT NULL,
    "ou" TEXT NOT NULL,
    "direction" TEXT,
    "service" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastLogon" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdAccount_pkey" PRIMARY KEY ("samAccountName")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "acteur" TEXT,
    "cible" TEXT,
    "details" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MagicToken_token_key" ON "MagicToken"("token");

-- CreateIndex
CREATE INDEX "MagicToken_userId_idx" ON "MagicToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Coach_userId_key" ON "Coach"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Coach_token_key" ON "Coach"("token");

-- CreateIndex
CREATE INDEX "Coach_actif_idx" ON "Coach"("actif");

-- CreateIndex
CREATE UNIQUE INDEX "Saison_nom_key" ON "Saison"("nom");

-- CreateIndex
CREATE INDEX "Fermeture_saisonId_idx" ON "Fermeture"("saisonId");

-- CreateIndex
CREATE UNIQUE INDEX "Activite_nom_key" ON "Activite"("nom");

-- CreateIndex
CREATE INDEX "Creneau_saisonId_idx" ON "Creneau"("saisonId");

-- CreateIndex
CREATE INDEX "Creneau_activiteId_idx" ON "Creneau"("activiteId");

-- CreateIndex
CREATE INDEX "Creneau_coachId_idx" ON "Creneau"("coachId");

-- CreateIndex
CREATE INDEX "Seance_date_idx" ON "Seance"("date");

-- CreateIndex
CREATE INDEX "Seance_statut_idx" ON "Seance"("statut");

-- CreateIndex
CREATE UNIQUE INDEX "Seance_creneauId_date_key" ON "Seance"("creneauId", "date");

-- CreateIndex
CREATE INDEX "Presence_userId_idx" ON "Presence"("userId");

-- CreateIndex
CREATE INDEX "Presence_etat_idx" ON "Presence"("etat");

-- CreateIndex
CREATE UNIQUE INDEX "Presence_seanceId_userId_key" ON "Presence"("seanceId", "userId");

-- CreateIndex
CREATE INDEX "Inscription_statut_idx" ON "Inscription"("statut");

-- CreateIndex
CREATE INDEX "Inscription_userId_idx" ON "Inscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Inscription_creneauId_userId_key" ON "Inscription"("creneauId", "userId");

-- CreateIndex
CREATE INDEX "AdAccount_enabled_idx" ON "AdAccount"("enabled");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- AddForeignKey
ALTER TABLE "MagicToken" ADD CONSTRAINT "MagicToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coach" ADD CONSTRAINT "Coach_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fermeture" ADD CONSTRAINT "Fermeture_saisonId_fkey" FOREIGN KEY ("saisonId") REFERENCES "Saison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creneau" ADD CONSTRAINT "Creneau_saisonId_fkey" FOREIGN KEY ("saisonId") REFERENCES "Saison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creneau" ADD CONSTRAINT "Creneau_activiteId_fkey" FOREIGN KEY ("activiteId") REFERENCES "Activite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creneau" ADD CONSTRAINT "Creneau_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seance" ADD CONSTRAINT "Seance_creneauId_fkey" FOREIGN KEY ("creneauId") REFERENCES "Creneau"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_seanceId_fkey" FOREIGN KEY ("seanceId") REFERENCES "Seance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "Inscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inscription" ADD CONSTRAINT "Inscription_creneauId_fkey" FOREIGN KEY ("creneauId") REFERENCES "Creneau"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inscription" ADD CONSTRAINT "Inscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

