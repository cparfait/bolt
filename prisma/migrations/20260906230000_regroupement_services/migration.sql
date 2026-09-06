-- Regroupement des libellés de service.
--
-- « Ce libellé-là désigne ce service-ci ». Un annuaire réel n'écrit pas deux
-- fois le même service de la même façon : « Crèche La Cigogne » et « Crèche
-- Petit Poucet » relèvent de la petite enfance, « CTM » désigne le centre
-- technique municipal sans partager un caractère avec lui. Aucune règle
-- d'écriture ne rattrape ça — il faut une table de correspondance.
--
-- La source est la clé primaire : un libellé ne peut désigner qu'un service.
CREATE TABLE "RegroupementService" (
    "source" TEXT NOT NULL,
    "cible" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegroupementService_pkey" PRIMARY KEY ("source")
);

-- Composition d'un service : quels libellés il agrège. C'est la seule vue qui
-- permette de vérifier un regroupement après coup.
CREATE INDEX "RegroupementService_cible_idx" ON "RegroupementService"("cible");

-- Rattachement décidé à la main, que les règles ne défont pas.
--
-- Sans ce témoin, corriger le service d'une personne à l'écran tiendrait
-- jusqu'à la synchronisation suivante : `User.service` est recalculé depuis le
-- libellé brut du miroir d'annuaire, et la correction disparaîtrait dans la
-- nuit sans que rien ne l'explique.
ALTER TABLE "User" ADD COLUMN "serviceForce" BOOLEAN NOT NULL DEFAULT false;
