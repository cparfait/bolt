/**
 * Point d'entrée exécuté une fois au démarrage du serveur Next.
 *
 * C'est le seul endroit où l'application peut lancer quelque chose sans qu'une
 * requête l'ait demandé — donc le seul endroit d'où un ordonnanceur peut
 * partir. Le garde sur `NEXT_RUNTIME` est nécessaire : ce fichier est aussi
 * chargé par le runtime Edge, qui n'a ni minuteur long ni accès à la base.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { demarrerOrdonnanceur } = await import("@/lib/ordonnanceur");
  demarrerOrdonnanceur();
}
