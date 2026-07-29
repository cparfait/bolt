/**
 * Limitation de débit en mémoire, par clé (login, jeton animateur, adresse IP).
 *
 * Suffisant pour une instance unique — c'est le cas ici. Derrière plusieurs
 * répliques, chaque instance compte séparément : il faudrait alors un compteur
 * partagé (Redis). Le verrouillage du PIN animateur, lui, est persisté en base
 * (Coach.pinLockedUntil) précisément pour ne pas dépendre de ce cache.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Purge paresseuse : évite une croissance illimitée sans timer de fond.
function purge(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}

export type RateLimitResult = { ok: boolean; retryAfterSec: number };

export function rateLimit(key: string, limit: number, windowSec: number): RateLimitResult {
  const now = Date.now();
  purge(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { ok: true, retryAfterSec: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
