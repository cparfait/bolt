/**
 * Point d'entrée exécuté une fois au démarrage du serveur Next.
 *
 * C'est le seul endroit où l'application peut lancer quelque chose sans qu'une
 * requête l'ait demandé — donc le seul endroit d'où un ordonnanceur peut
 * partir. Le garde sur `NEXT_RUNTIME` est nécessaire : ce fichier est aussi
 * chargé par le runtime Edge, qui n'a ni minuteur long ni accès à la base.
 */
/**
 * Erreurs non rattrapées pendant le rendu ou une action serveur.
 *
 * Sans ce point d'entrée, Next affiche l'écran d'erreur générique et la cause
 * n'est écrite nulle part : la page promettait « l'incident a été enregistré »
 * alors que rien ne l'enregistrait. On écrit ici une ligne dans les journaux
 * du conteneur (`docker logs`), avec le digest que l'écran montre à
 * l'utilisateur — c'est le lien entre ce qu'il voit et ce que la DSI lit.
 */
export function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
): void {
  const digest =
    typeof error === "object" && error && "digest" in error
      ? String((error as { digest?: unknown }).digest ?? "")
      : "";
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[bolt] erreur ${digest || "sans digest"} — ${request.method} ${request.path} (${context.routeType} ${context.routePath}) : ${message}`,
  );
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { demarrerOrdonnanceur } = await import("@/lib/ordonnanceur");
  demarrerOrdonnanceur();
}
