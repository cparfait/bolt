-- Adresse de contact, distincte de celle de l'annuaire.
--
-- `User.email` est réécrite depuis l'Active Directory à chaque connexion : on ne
-- pouvait donc pas y saisir l'adresse d'un agent sans boîte professionnelle —
-- terrain, crèches, gardiennage —, qui est précisément la population visée par
-- la connexion par lien. Ce champ-là n'est jamais touché par la synchronisation.
ALTER TABLE "User" ADD COLUMN "emailContact" TEXT;

CREATE INDEX "User_emailContact_idx" ON "User"("emailContact");
