-- Trace de ce que l'agent a accepté en s'inscrivant en ligne : les cinq
-- déclarations de la page 2 du formulaire papier, et les mentions
-- d'information de la page 3.
--
-- Colonnes nullables, et c'est voulu : les inscriptions déjà en base ont été
-- couvertes par une fiche papier signée, et celles que le service des sports
-- saisit pour un agent le restent. Un NULL se lit « pas d'acceptation en
-- ligne », jamais « acceptation supposée ».
ALTER TABLE "Inscription" ADD COLUMN "declarationsAt" TIMESTAMP(3);
ALTER TABLE "Inscription" ADD COLUMN "declarationsVersion" TEXT;
ALTER TABLE "Inscription" ADD COLUMN "consentementRgpdAt" TIMESTAMP(3);
