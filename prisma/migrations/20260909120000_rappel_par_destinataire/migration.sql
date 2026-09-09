-- Savoir à qui le rappel est parti, et pas seulement qu'une campagne a eu lieu.
--
-- La séance portait un seul horodatage, posé à la fin de la boucle d'envoi
-- quoi qu'il se soit passé pendant. Microsoft 365 plafonne les soumissions
-- SMTP à trente messages par minute : au-delà, chaque envoi était refusé, la
-- boucle continuait, la séance se marquait « rappelée », et les inscrits
-- suivants ne recevaient rien — sans qu'aucune trace ne dise lesquels.
--
-- Une ligne par remise. La campagne s'interrompt au premier refus de la
-- messagerie et reprend au passage suivant, cinq minutes plus tard, là où
-- elle s'est arrêtée. `erreur` note un destinataire rejeté pour lui-même
-- (adresse inconnue) : lui seul n'est pas retenté.
CREATE TABLE "RappelEnvoye" (
    "seanceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "envoyeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erreur" TEXT,

    CONSTRAINT "RappelEnvoye_pkey" PRIMARY KEY ("seanceId","userId")
);

CREATE INDEX "RappelEnvoye_userId_idx" ON "RappelEnvoye"("userId");

ALTER TABLE "RappelEnvoye" ADD CONSTRAINT "RappelEnvoye_seanceId_fkey" FOREIGN KEY ("seanceId") REFERENCES "Seance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RappelEnvoye" ADD CONSTRAINT "RappelEnvoye_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
