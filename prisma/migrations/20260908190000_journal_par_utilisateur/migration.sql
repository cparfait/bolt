-- Savoir ce qu'on a fait à quelqu'un, et pas seulement ce qu'il a fait.
--
-- Le journal n'indexait que l'acteur (`userId`). La personne concernée n'y
-- figurait qu'en toutes lettres, dans `cible` — « Camille MARTIN → Yoga » —,
-- ce qu'aucune requête ne sait retrouver. Devant une fiche d'agent, la question
-- posée est pourtant celle-là : qui l'a retiré de son créneau, quand son accès
-- a-t-il été fermé, qui a corrigé son service.
--
-- `cibleId` répond à cette question sans toucher à l'existant : les lignes
-- déjà écrites restent lisibles, elles n'ont simplement pas de cible indexée.
ALTER TABLE "AuditLog" ADD COLUMN "cibleId" TEXT;
CREATE INDEX "AuditLog_cibleId_idx" ON "AuditLog"("cibleId");
