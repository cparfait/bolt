-- Participants hors annuaire créés avant le passage au préfixe « no_ad. ».
--
-- Le changement de préfixe n'avait porté que sur le code : les lignes déjà en
-- base gardaient « ext.… », et tout ce qui distingue un participant créé à la
-- main d'un compte d'annuaire se fonde sur ce préfixe. Ces comptes étaient donc
-- classés parmi les comptes Active Directory — visibles comme tels à l'écran, et
-- surtout candidats à la désactivation automatique, puisque la synchronisation
-- les cherchait dans un annuaire où ils n'ont jamais existé.
--
-- Trois conditions, parce qu'un renommage d'identifiant ne se rejoue pas :
--
--   1. le miroir de l'annuaire doit être peuplé. Vide, il ne permettrait pas de
--      distinguer un participant manuel d'un compte AD réellement nommé
--      « ext.qqch » — cas courant pour les prestataires dans certains annuaires.
--      La migration ne fait alors rien, plutôt que de renommer à l'aveugle ;
--   2. aucun compte de l'annuaire ne porte cet identifiant ;
--   3. l'identifiant d'arrivée est libre — la colonne est unique.
UPDATE "User" u
SET login = 'no_ad.' || substring(lower(u.login) from 5)
WHERE lower(u.login) LIKE 'ext.%'
  AND u."isLocal" = false
  AND (SELECT count(*) FROM "AdAccount") > 0
  AND NOT EXISTS (
    SELECT 1 FROM "AdAccount" a
    WHERE lower(a."samAccountName") = lower(u.login)
  )
  AND NOT EXISTS (
    SELECT 1 FROM "User" v
    WHERE v.login = 'no_ad.' || substring(lower(u.login) from 5)
  );
