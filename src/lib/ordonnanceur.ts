import { declencherRappelsSiBesoin } from "./rappels";
import { declencherPurgeSiBesoin } from "./purge";
import { declencherSyncSiBesoin } from "./annuaire";
import { declencherAvisDemandesSiBesoin } from "./demandes";
import { siPersonneDAutre } from "./verrou";

/**
 * Ordonnanceur interne au conteneur.
 *
 * ── Ce qu'il remplace, et pourquoi ────────────────────────────────────────
 *
 * Les tâches de fond — rappels de séance, durées de conservation,
 * synchronisation de l'annuaire — étaient déclenchées « au fil du trafic » :
 * l'affichage du tableau de bord lançait la vérification. C'était commode à
 * écrire, et faux en exploitation. Sur une application consultée par à-coups,
 * personne ne passe la nuit ni le week-end : un rappel dû à 18 h pour une
 * séance du lendemain partait à la première connexion du matin — parfois le
 * jour même de la séance, ce qui n'est plus un rappel. Pire, la conséquence
 * est invisible : rien n'échoue, rien n'alerte, les courriels sortent
 * simplement trop tard.
 *
 * Le minuteur ci-dessous tourne dans le processus qui sert déjà les pages.
 * Aucun conteneur supplémentaire, aucune crontab à maintenir sur l'hôte, et
 * surtout : il tourne que quelqu'un se connecte ou non.
 *
 * ── Ce qui ne change pas ──────────────────────────────────────────────────
 *
 * Les verrous restent portés par les tâches elles-mêmes, en base : c'est eux,
 * et non ce minuteur, qui font qu'une séance n'est rappelée qu'une fois et
 * que l'annuaire n'est lu qu'une fois par jour. La route
 * `GET /api/taches/rappels` continue donc de fonctionner pour qui préfère un
 * ordonnanceur externe.
 *
 * Ces verrous-là sont des « lire puis écrire », pas des opérations atomiques :
 * ils écartent un second passage quelques minutes plus tard, pas deux
 * instances qui battent dans la même seconde. C'est le verrou consultatif
 * PostgreSQL de `battement` (src/lib/verrou.ts) qui tient ce cas — partagé
 * avec la route de cron, pour que les deux voies ne se croisent pas non plus.
 */

/**
 * Période du battement. Chaque tâche décide ensuite si son tour est venu :
 * cinq minutes ne veulent pas dire cinq minutes de travail, mais cinq minutes
 * de précision sur l'heure d'envoi d'un rappel.
 */
const PERIODE_MS = 5 * 60 * 1000;

/**
 * Délai avant le premier battement. Le conteneur applique ses migrations puis
 * démarre le serveur : on laisse la base finir de s'installer plutôt que de
 * lancer une campagne de courriels dans la seconde qui suit le démarrage.
 */
const DEMARRAGE_MS = 30 * 1000;

/**
 * Un seul minuteur par processus, même après un rechargement à chaud.
 * En développement, Next réévalue les modules sans redémarrer le serveur :
 * sans ce témoin porté par `globalThis`, chaque modification empilerait un
 * minuteur de plus.
 */
const TEMOIN = Symbol.for("bolt.ordonnanceur");
type PorteurTemoin = { [TEMOIN]?: NodeJS.Timeout };

/** Clé du verrou partagé entre l'ordonnanceur interne et la route de cron. */
export const VERROU_TACHES = "bolt:taches-de-fond";

/** Les tâches de fond, dans l'ordre, chacune silencieuse sur son échec. */
export async function executerTaches(origine: "ordonnanceur" | "cron"): Promise<void> {
  // Chaque tâche est déjà silencieuse en cas d'échec ; ce filet attrape ce qui
  // resterait. Un ordonnanceur qui meurt sur une erreur ne redémarrerait
  // qu'au prochain déploiement, et personne ne le remarquerait avant des
  // semaines.
  for (const tache of [
    declencherRappelsSiBesoin,
    declencherPurgeSiBesoin,
    () => declencherSyncSiBesoin(origine),
    declencherAvisDemandesSiBesoin,
  ]) {
    try {
      await tache();
    } catch {
      // le battement suivant réessaiera
    }
  }
}

async function battement(): Promise<void> {
  try {
    // Une seule instance à la fois, quel que soit le nombre de conteneurs ou
    // de crons : les verrous propres à chaque tâche ne sont pas atomiques,
    // celui-ci l'est (src/lib/verrou.ts).
    await siPersonneDAutre(VERROU_TACHES, () => executerTaches("ordonnanceur"));
  } catch {
    // base injoignable : le battement suivant réessaiera
  }
}

/** Démarre le minuteur. Sans effet s'il tourne déjà. */
export function demarrerOrdonnanceur(): void {
  const porteur = globalThis as PorteurTemoin;
  if (porteur[TEMOIN]) return;

  const minuteur = setInterval(() => void battement(), PERIODE_MS);
  // `unref` : le minuteur ne doit pas retenir le processus au moment d'un
  // arrêt propre. Le serveur HTTP, lui, le maintient en vie.
  minuteur.unref?.();
  porteur[TEMOIN] = minuteur;

  const amorce = setTimeout(() => void battement(), DEMARRAGE_MS);
  amorce.unref?.();
}
