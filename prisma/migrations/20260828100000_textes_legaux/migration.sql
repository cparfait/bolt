-- Versions archivées des déclarations et mentions d'information.
--
-- Les textes deviennent modifiables depuis Paramètres → Déclarations. Sans cet
-- archivage, la première correction réécrirait rétroactivement ce que les
-- agents déjà inscrits ont accepté : leur inscription porte un numéro de
-- version, ce numéro doit continuer de désigner le texte qu'ils ont lu.
CREATE TABLE "TexteLegal" (
    "version" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creePar" TEXT,

    CONSTRAINT "TexteLegal_pkey" PRIMARY KEY ("version")
);
