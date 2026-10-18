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

/**
 * Secrets publiés dans le dépôt : longs de plus de 32 caractères, ils passent
 * le contrôle de longueur, mais quiconque lit le code les connaît et peut
 * forger un cookie de session — administrateur compris. Un `.env.example`
 * copié tel quel en production suffisait. La valeur d'exemple n'est plus
 * renseignée, mais une installation qui l'a déjà reprise doit refuser de
 * démarrer plutôt que de rester ouverte. docker-entrypoint.sh tient la même
 * liste, pour échouer dès le lancement du conteneur.
 */
const SECRETS_PUBLIES = new Set([
  DEV,
  "changez-moi-chaine-aleatoire-de-32-caracteres-minimum",
]);

/** Le secret est-il utilisable en production ? Exporté pour les tests. */
export function secretAcceptable(secret: string | undefined): boolean {
  return !!secret && secret.length >= 32 && !SECRETS_PUBLIES.has(secret.trim());
}

export function secretApplicatif(): string {
  const secret = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV !== "production") {
    return secret && secret.length >= 32 ? secret : DEV;
  }
  if (secret && secretAcceptable(secret)) return secret;
  if (secret && SECRETS_PUBLIES.has(secret.trim())) {
    throw new Error(
      "SESSION_SECRET reprend une valeur d'exemple publiée dans le dépôt — " +
        "générez-en un (openssl rand -base64 32). Les mots de passe LDAP et SMTP " +
        "enregistrés seront à ressaisir dans Paramètres.",
    );
  }
  throw new Error(
    "SESSION_SECRET absent ou trop court (32 caractères minimum) — " +
      "refus de démarrer en production avec le secret de développement par défaut.",
  );
}
