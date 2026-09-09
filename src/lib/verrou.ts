import { prisma } from "./db";

/**
 * Exclusion mutuelle entre instances, portée par PostgreSQL.
 *
 * Les tâches de fond — rappels, purge, synchronisation de l'annuaire, avis de
 * demandes — se protègent d'un second passage par un « lire puis écrire » en
 * base : suffisant contre un battement cinq minutes plus tard, pas contre
 * deux conteneurs qui battent dans la même seconde. L'application tourne sur
 * une seule instance aujourd'hui, mais rien ne l'empêche d'en avoir deux un
 * jour, et un rappel envoyé deux fois se remarque.
 *
 * `pg_try_advisory_xact_lock` : si une autre instance tient déjà le verrou, on
 * ne fait rien — elle fait le travail, inutile d'attendre derrière elle. Le
 * verrou vit le temps de la transaction porteuse ; les requêtes du corps
 * passent par le client habituel, ce n'est pas l'isolation qu'on cherche mais
 * l'exclusion, et elle tient tant que la transaction ne se termine qu'après
 * elles.
 */
export async function siPersonneDAutre<T>(
  cle: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  return prisma.$transaction(
    async (tx) => {
      const [{ obtenu }] = await tx.$queryRaw<{ obtenu: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${cle})) AS obtenu
      `;
      if (!obtenu) return null;
      return fn();
    },
    // Une campagne de rappels cadencée à 25 messages par minute peut durer.
    { maxWait: 10_000, timeout: 20 * 60_000 },
  );
}
