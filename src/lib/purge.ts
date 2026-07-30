import { prisma } from "./db";
import { getSetting, setSetting } from "./settings";
import { ajouterJours } from "./dates";

/**
 * Effacement automatique des données de journalisation.
 *
 * Deux durées, parce que deux natures de données cohabitent dans le journal, et
 * qu'une durée unique serait forcément trop longue pour l'une ou trop courte
 * pour l'autre :
 *
 *  • **l'adresse IP** est une donnée personnelle qui ne sert qu'au diagnostic
 *    récent — « d'où cette feuille a-t-elle été pointée lundi », « ce compte
 *    subit-il des tentatives depuis une seule adresse ». Passé un trimestre,
 *    elle ne répond plus à aucune question qu'on se pose encore ;
 *
 *  • **la trace de l'action**, elle, est la mémoire administrative du service :
 *    qui a validé cette inscription, qui a annulé cette séance, qui a été
 *    prévenu. Elle garde son utilité une saison entière, et c'est ce qu'on
 *    ressort quand un agent conteste.
 *
 * D'où : l'IP est effacée à 3 mois, la ligne entière à 12 mois. Les jetons de
 * connexion par courriel, valables trente minutes, n'ont aucune raison de
 * survivre : tout jeton de plus de 30 jours est mort depuis longtemps.
 *
 * Les durées sont ici, en clair et en un seul endroit, pour être recopiables
 * telles quelles dans le registre des traitements — et modifiables sans avoir à
 * relire l'application.
 */

/** Adresses IP : journal d'audit et dernier accès des animateurs. */
export const JOURS_CONSERVATION_IP = 90;

/** Lignes du journal d'audit, action comprise. */
export const JOURS_CONSERVATION_JOURNAL = 365;

/** Jetons de connexion par courriel (valables 30 minutes à l'émission). */
export const JOURS_CONSERVATION_JETONS = 30;

const CLE_VERROU = "purge:dernier";
const INTERVALLE_MS = 24 * 60 * 60 * 1000;

export type ResultatPurge = {
  ipsEffacees: number;
  lignesSupprimees: number;
  jetonsSupprimes: number;
  accesAnonymises: number;
};

/**
 * Applique les durées de conservation. Idempotent : deux exécutions d'affilée
 * ne suppriment rien de plus, ce qui permet de la déclencher sans précaution.
 */
export async function purger(): Promise<ResultatPurge> {
  const maintenant = new Date();
  const seuilIp = ajouterJours(maintenant, -JOURS_CONSERVATION_IP);
  const seuilJournal = ajouterJours(maintenant, -JOURS_CONSERVATION_JOURNAL);
  const seuilJetons = ajouterJours(maintenant, -JOURS_CONSERVATION_JETONS);

  // Ordre volontaire : on efface d'abord les lignes périmées, puis les IP des
  // lignes qui restent. L'inverse ferait travailler la première requête sur des
  // lignes que la seconde allait supprimer.
  const lignes = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: seuilJournal } },
  });

  const ips = await prisma.auditLog.updateMany({
    where: { createdAt: { lt: seuilIp }, ip: { not: null } },
    data: { ip: null },
  });

  // Trace du dernier accès d'un animateur : la date reste (elle dit si un lien
  // dort et peut être révoqué), l'adresse s'en va.
  const acces = await prisma.coach.updateMany({
    where: { lastAccessAt: { lt: seuilIp }, lastAccessIp: { not: null } },
    data: { lastAccessIp: null },
  });

  const jetons = await prisma.magicToken.deleteMany({
    where: { createdAt: { lt: seuilJetons } },
  });

  return {
    ipsEffacees: ips.count,
    lignesSupprimees: lignes.count,
    jetonsSupprimes: jetons.count,
    accesAnonymises: acces.count,
  };
}

/**
 * Déclenchement opportuniste, une fois par jour au plus, sur le modèle de
 * `declencherRappelsSiBesoin`.
 *
 * Pourquoi pas seulement un cron : le `CRON_TOKEN` est facultatif, et une
 * installation qui n'en pose pas ne doit pas conserver des adresses IP pour
 * autant. L'application tient donc ses propres durées, que l'ordonnanceur
 * existe ou non. Silencieux : une purge qui échoue ne doit jamais empêcher un
 * gestionnaire d'afficher son tableau de bord.
 */
export async function declencherPurgeSiBesoin(): Promise<void> {
  try {
    const dernier = (await getSetting<number>(CLE_VERROU)) ?? 0;
    if (Date.now() - dernier < INTERVALLE_MS) return;
    // Verrou posé avant l'exécution : deux requêtes simultanées n'en lancent
    // qu'une. La purge étant idempotente, le pire cas reste inoffensif.
    await setSetting(CLE_VERROU, Date.now());
    await purger();
  } catch {
    // le tableau de bord doit s'afficher quoi qu'il arrive
  }
}
