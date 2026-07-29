/**
 * Service worker minimal de l'espace d'émargement.
 *
 * Il ne met rien en cache, volontairement : une feuille de présence servie hors
 * ligne serait périmée, et laisserait croire qu'un pointage est enregistré
 * alors qu'il n'est jamais parti. Sa seule raison d'être est de satisfaire les
 * critères d'installation du navigateur, pour que l'animateur puisse poser
 * l'application sur son écran d'accueil et conserver son lien.
 *
 * Servi depuis /emargement/ : sa portée couvre donc tous les jetons.
 */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Handler présent mais passant : le navigateur exécute sa requête normale.
self.addEventListener("fetch", () => {});
