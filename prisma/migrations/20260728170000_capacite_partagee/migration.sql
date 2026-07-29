-- Capacité mutualisée entre les créneaux d'une même activité.
--
-- Jusqu'ici, les places vivaient uniquement sur le créneau : une activité de
-- 10 places ouverte deux fois par semaine offrait en réalité 20 places, et
-- l'agent venant aux deux séances en consommait deux. Les activités qui
-- fonctionnent en groupe unique réparti sur plusieurs créneaux déclarent
-- désormais leur effectif ici.
--
-- Aucun changement de comportement pour l'existant : l'option est désactivée
-- par défaut, chaque créneau conserve sa propre capacité.
ALTER TABLE "Activite" ADD COLUMN "capacitePartagee" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Activite" ADD COLUMN "capacite" INTEGER;
