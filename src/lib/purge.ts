import { prisma } from "./db";
import { getSetting, setSetting } from "./settings";
import { ajouterJours } from "./dates";
import { audit } from "./audit";

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
 * Une fois par jour au plus, appelé par l'ordonnanceur interne
 * (src/lib/ordonnanceur.ts) et par la route de cron.
 *
 * L'application tient ses propres durées de conservation, que la collectivité
 * dispose ou non d'un ordonnanceur externe : `CRON_TOKEN` est facultatif, et
 * une installation qui n'en pose pas ne doit pas garder des adresses IP pour
 * autant. Silencieux : une purge qui échoue ne doit rien interrompre.
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

/**
 * Inscriptions et présences : la purge que l'application ne faisait pas.
 *
 * Les mentions d'information annoncent une durée de conservation. Jusqu'ici
 * rien ne l'appliquait : les inscriptions et les présences restaient
 * indéfiniment, et la collectivité annonçait donc une durée qu'elle ne tenait
 * pas — le genre d'écart qu'un contrôle relève en premier.
 *
 * Trois partis pris, parce que ce traitement est le plus destructeur de
 * l'application après la prise en compte des départs :
 *
 *  • **il ne part jamais tout seul.** Contrairement à la purge du journal, il
 *    n'est branché sur aucun déclencheur automatique : c'est un geste, fait par
 *    un administrateur qui sait ce qu'il efface. Un effacement irréversible qui
 *    se déclenche parce qu'un utilisateur a ouvert le tableau de bord serait
 *    une mauvaise surprise ;
 *  • **il se compte en saisons, pas en séances.** Le seuil s'applique à la date
 *    de fin de la saison : on n'efface pas la moitié d'une saison, ce qui
 *    fausserait ses statistiques sans que personne ne s'en aperçoive ;
 *  • **il s'annonce avant d'agir.** `compterAPurger` donne le décompte exact
 *    affiché sur le bouton, pour qu'on sache ce qu'on détruit avant de le
 *    détruire.
 */

export type DecomptePurge = {
  /** Fin de saison en deçà de laquelle tout part. */
  seuil: Date;
  saisons: string[];
  inscriptions: number;
  presences: number;
};

/** Saisons closes depuis plus de `mois`. */
function filtreSaison(seuil: Date) {
  return { saison: { fin: { lt: seuil } } };
}

function seuilDe(mois: number): Date {
  const seuil = new Date();
  seuil.setMonth(seuil.getMonth() - mois);
  return seuil;
}

/** Ce que la purge effacerait, sans rien effacer. */
export async function compterAPurger(mois: number): Promise<DecomptePurge> {
  const seuil = seuilDe(mois);
  const [saisons, inscriptions, presences] = await Promise.all([
    prisma.saison.findMany({
      where: { fin: { lt: seuil } },
      select: { nom: true },
      orderBy: { fin: "asc" },
    }),
    prisma.inscription.count({ where: { creneau: filtreSaison(seuil) } }),
    prisma.presence.count({ where: { seance: { creneau: filtreSaison(seuil) } } }),
  ]);
  return { seuil, saisons: saisons.map((s) => s.nom), inscriptions, presences };
}

/**
 * Efface inscriptions et présences des saisons closes depuis plus de `mois`.
 * Les séances et les créneaux restent : ils ne portent aucune donnée
 * personnelle, et les supprimer ferait disparaître l'historique de l'offre.
 */
export async function purgerInscriptions(
  mois: number,
  auteur: string,
): Promise<{ inscriptions: number; presences: number }> {
  const seuil = seuilDe(mois);

  // Les présences d'abord : elles sont rattachées à l'inscription en
  // `SetNull`, donc supprimer l'inscription seule les laisserait en place —
  // avec le nom de l'agent et sa venue à chaque séance.
  const presences = await prisma.presence.deleteMany({
    where: { seance: { creneau: filtreSaison(seuil) } },
  });
  const inscriptions = await prisma.inscription.deleteMany({
    where: { creneau: filtreSaison(seuil) },
  });

  await audit("PURGE_INSCRIPTIONS", {
    details: `${inscriptions.count} inscription(s) et ${presences.count} présence(s) antérieures au ${seuil.toLocaleDateString("fr-FR")}, par ${auteur}`,
  });

  return { inscriptions: inscriptions.count, presences: presences.count };
}
