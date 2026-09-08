/**
 * Le secret dont dérive tout ce que l'application signe : le cookie de session
 * (src/lib/session.ts) et les liens d'action envoyés par courriel
 * (src/lib/absence-lien.ts).
 *
 * Un seul endroit décide, pour que la règle « en production, jamais le secret
 * de développement » n'ait pas à être réécrite — et donc à être oubliée — à
 * chaque nouvel usage. Résolu à l'appel plutôt qu'au chargement du module :
 * `next build` s'exécute sans les variables d'exécution.
 */

const DEV = "bolt-dev-secret-a-changer-en-production-0123456789";

export function secretApplicatif(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET absent ou trop court (32 caractères minimum) — " +
        "refus de démarrer en production avec le secret de développement par défaut.",
    );
  }
  return DEV;
}
