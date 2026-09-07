-- Supprimer un créneau ou une activité sans perdre la fréquentation.
--
-- Jusqu'ici, la suppression était refusée dès qu'une feuille d'émargement
-- existait — et refusée en silence, le bouton ne disant rien. C'était le bon
-- réflexe pour une mauvaise raison : ce n'est pas la suppression qu'il fallait
-- interdire, c'est la cascade. Présences et séances pendent au créneau ; les
-- effacer ferait mentir rétroactivement le bilan d'une saison close.
--
-- D'où l'archivage : la ligne reste en base, invisible partout où le service
-- travaille, entière partout où l'on compte. Ce qui n'a jamais servi continue,
-- lui, d'être réellement supprimé.
ALTER TABLE "Activite" ADD COLUMN "archiveAt" TIMESTAMP(3);
ALTER TABLE "Creneau" ADD COLUMN "archiveAt" TIMESTAMP(3);
