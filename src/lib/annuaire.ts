import { prisma } from "./db";
import { ldapFetchAccounts } from "./ldap";
import { getLdapSettings, getSetting, setSetting, type LdapSettings } from "./settings";
import { adosseALAnnuaire, desactiverCompte } from "./departs";
import { audit } from "./audit";

/**
 * Synchronisation du miroir de l'annuaire, et prise en compte des départs.
 *
 * Bolt n'écrit jamais dans l'Active Directory : il en lit une copie
 * (`AdAccount`) qui sert à inscrire un agent jamais connecté, à ouvrir la
 * connexion par lien, et à tenir les statistiques par direction.
 *
 * Elle traite aussi les départs, ce qui manquait : un agent dont le compte AD
 * est désactivé ou supprimé ne peut plus se connecter par son identifiant
 * Windows — le bind échoue — mais son compte Bolt restait actif indéfiniment.
 * Il gardait sa place sur un créneau, apparaissait sur les feuilles
 * d'émargement, et surtout pouvait encore recevoir un lien de connexion par
 * courriel : `envoyerLienConnexion` cherche d'abord un compte Bolt actif et ne
 * consultait donc jamais l'état du compte dans l'annuaire.
 *
 * ── Le garde-fou, qui est le cœur du sujet ────────────────────────────────
 *
 * Conclure d'une ABSENCE est dangereux : un Base DN mal recopié, un groupe
 * filtrant trop restrictif ou une lecture interrompue rendent une liste courte,
 * et l'on effacerait alors la moitié du service par déduction. On ne se fie donc
 * pas au nombre de comptes lus dans l'absolu, mais à une population témoin : les
 * comptes de l'application adossés à l'annuaire et encore actifs. Ces gens se sont connectés
 * par CET annuaire, ils y existent donc — si la lecture n'en retrouve pas au
 * moins 80 %, elle est incomplète, et l'on refuse d'interpréter les absents.
 *
 * Un compte explicitement marqué désactivé dans l'AD, lui, est une affirmation
 * et non une déduction : il est traité dans tous les cas.
 */

/** Part de la population témoin qu'une lecture doit retrouver pour être crue. */
export const SEUIL_PLAUSIBILITE = 0.8;

/**
 * Cette lecture de l'annuaire est-elle trop courte pour qu'on en déduise des
 * départs ?
 *
 * `temoins` : comptes Bolt actifs adossés à l'annuaire. `retrouves` : ceux
 * d'entre eux que la lecture a effectivement rendus. Sans témoin — première
 * installation, aucun agent encore connecté — il n'y a rien à comparer et rien à
 * conclure non plus : la lecture est acceptée, et de toute façon aucun compte
 * n'est candidat au départ.
 *
 * Fonction pure et exportée pour être testée seule : c'est le garde-fou qui
 * empêche un Base DN mal recopié d'effacer un service entier.
 */
export function lectureJugeeIncomplete(temoins: number, retrouves: number): boolean {
  if (temoins === 0) return false;
  return retrouves < temoins * SEUIL_PLAUSIBILITE;
}

/**
 * Ce compte Bolt doit-il être fermé au vu de l'annuaire ?
 *
 * Deux situations à ne pas confondre :
 *  • le compte est dans la lecture et marqué désactivé — l'annuaire l'AFFIRME,
 *    on agit toujours ;
 *  • le compte est absent de la lecture — on le DÉDUIT, et seulement si la
 *    lecture est jugée complète.
 */
export function estUnDepart(
  ad: { enabled: boolean } | undefined,
  incomplete: boolean,
): boolean {
  if (ad) return !ad.enabled;
  return !incomplete;
}

const CLE_VERROU = "annuaire:dernier";
const INTERVALLE_MS = 24 * 60 * 60 * 1000;

export type ResultatSync = {
  comptesLus: number;
  /** Lignes du miroir supprimées, faute de compte correspondant dans l'AD. */
  miroirNettoye: number;
  /** Noms des agents désactivés par ce passage. */
  desactives: string[];
  /** Comptes Bolt adossés à l'annuaire que la lecture n'a pas retrouvés. */
  absents: string[];
  inscriptionsRetirees: number;
  promotions: string[];
  /** Vrai si le garde-fou a empêché d'interpréter les absences. */
  lectureIncomplete: boolean;
  message: string;
};

export async function synchroniserAnnuaire(
  cfg: LdapSettings,
  acteur: string,
  options: { exclure?: string } = {},
): Promise<ResultatSync> {
  // Lève si le groupe filtrant est introuvable : mieux vaut ne rien
  // synchroniser que de travailler sur une liste vide (voir ldap.ts).
  const comptes = await ldapFetchAccounts(cfg);
  const parLogin = new Map(comptes.map((c) => [c.samAccountName.toLowerCase(), c]));

  for (const c of comptes) {
    const { samAccountName, ...reste } = c;
    await prisma.adAccount.upsert({
      where: { samAccountName },
      update: { ...reste, syncedAt: new Date() },
      create: { samAccountName, ...reste, syncedAt: new Date() },
    });
  }

  // Rattachement hiérarchique des comptes Bolt déjà connus : les statistiques
  // par direction restent justes même sans reconnexion.
  //
  // On ne réécrit que ce qui a bougé. La boucle précédente faisait déjà un
  // aller-retour par compte d'annuaire ; en ajouter un second systématique
  // doublait la durée d'une synchronisation qui, d'une nuit à l'autre, ne change
  // presque rien. Une valeur absente de l'AD (`undefined`) laisse le champ en
  // place plutôt que de l'effacer — un annuaire incomplet ne doit pas vider un
  // rattachement saisi ailleurs.
  const connus = new Map(
    (
      await prisma.user.findMany({
        select: { id: true, login: true, direction: true, service: true },
      })
    ).map((u) => [u.login.toLowerCase(), u]),
  );
  for (const c of comptes) {
    const u = connus.get(c.samAccountName.toLowerCase());
    if (!u) continue;
    const direction = c.direction ?? undefined;
    const service = c.service ?? undefined;
    const inchange =
      (direction === undefined || direction === u.direction) &&
      (service === undefined || service === u.service);
    if (inchange) continue;
    await prisma.user.update({ where: { id: u.id }, data: { direction, service } });
  }

  // ── Population témoin et garde-fou ────────────────────────────────────────
  const actifs = (
    await prisma.user.findMany({
      where: { active: true },
      select: { id: true, login: true, displayName: true, isLocal: true },
    })
  ).filter((u) => adosseALAnnuaire(u) && u.id !== options.exclure);

  const retrouves = actifs.filter((u) => parLogin.has(u.login.toLowerCase()));
  const lectureIncomplete = lectureJugeeIncomplete(actifs.length, retrouves.length);

  // Qui manque à l'appel, nommément. Sans cette liste, un avertissement de
  // lecture incomplète n'apprend rien : il faut deviner s'il s'agit de départs
  // réels, d'un filtre trop étroit, ou de comptes qui n'ont jamais eu leur place
  // dans cette population. Avec elle, la cause saute aux yeux.
  const absents = actifs
    .filter((u) => !parLogin.has(u.login.toLowerCase()))
    .map((u) => `${u.displayName} (${u.login})`)
    .sort((a, b) => a.localeCompare(b, "fr"));

  // ── Départs ───────────────────────────────────────────────────────────────
  const desactives: string[] = [];
  const promotions: string[] = [];
  let inscriptionsRetirees = 0;

  for (const u of actifs) {
    const ad = parLogin.get(u.login.toLowerCase());
    if (!estUnDepart(ad, lectureIncomplete)) continue;

    const motif = ad
      ? "compte désactivé dans l'annuaire"
      : "compte absent de l'annuaire";
    const r = await desactiverCompte(u.id, { acteur, desinscrire: true, motif });
    if (!r.applique) continue;
    desactives.push(r.nom);
    inscriptionsRetirees += r.inscriptionsRetirees;
    promotions.push(...r.promotions);
  }

  // ── Miroir : on retire les fantômes ───────────────────────────────────────
  // Sans cela, une personne partie restait proposable à l'inscription depuis le
  // miroir, et pouvait être réinscrite le lendemain de sa désactivation.
  let miroirNettoye = 0;
  if (!lectureIncomplete) {
    const supprimes = await prisma.adAccount.deleteMany({
      where: { samAccountName: { notIn: comptes.map((c) => c.samAccountName) } },
    });
    miroirNettoye = supprimes.count;
  }

  await audit("ANNUAIRE_SYNCHRONISE", {
    acteur,
    details: [
      `${comptes.length} comptes lus`,
      desactives.length > 0 ? `${desactives.length} compte(s) désactivé(s)` : null,
      inscriptionsRetirees > 0 ? `${inscriptionsRetirees} inscription(s) retirée(s)` : null,
      miroirNettoye > 0 ? `${miroirNettoye} ligne(s) de miroir supprimée(s)` : null,
      lectureIncomplete ? "LECTURE JUGÉE INCOMPLÈTE : absences non interprétées" : null,
      absents.length > 0 ? `absents de l'annuaire : ${absents.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(", "),
  });

  return {
    comptesLus: comptes.length,
    miroirNettoye,
    desactives,
    absents,
    inscriptionsRetirees,
    promotions,
    lectureIncomplete,
    message: redigerMessage({
      comptesLus: comptes.length,
      miroirNettoye,
      desactives,
      absents,
      inscriptionsRetirees,
      promotions,
      lectureIncomplete,
      temoins: actifs.length,
      retrouves: retrouves.length,
    }),
  };
}

function redigerMessage(r: {
  comptesLus: number;
  miroirNettoye: number;
  desactives: string[];
  absents: string[];
  inscriptionsRetirees: number;
  promotions: string[];
  lectureIncomplete: boolean;
  temoins: number;
  retrouves: number;
}): string {
  const phrases = [`${r.comptesLus} comptes synchronisés depuis l'annuaire.`];

  if (r.lectureIncomplete) {
    phrases.push(
      `Attention : seuls ${r.retrouves} des ${r.temoins} comptes de l'application adossés à l'annuaire ont été retrouvés dans cette lecture. ` +
        `Elle est probablement incomplète — Base DN ou groupe filtrant à vérifier. ` +
        `Aucun compte n'a été désactivé pour cause d'absence, et le miroir n'a pas été nettoyé.`,
    );
  }

  // La liste des absents, dans les deux cas : quand la lecture est refusée elle
  // désigne la cause, quand elle est acceptée elle dit qui va être désactivé.
  if (r.absents.length > 0) {
    const noms = r.absents.slice(0, 10).join(", ");
    const reste = r.absents.length > 10 ? ` et ${r.absents.length - 10} autre(s)` : "";
    phrases.push(`Comptes de l'application introuvables dans l'annuaire : ${noms}${reste}.`);
  }

  if (r.desactives.length > 0) {
    const noms = r.desactives.slice(0, 5).join(", ");
    const reste = r.desactives.length > 5 ? ` et ${r.desactives.length - 5} autre(s)` : "";
    phrases.push(
      `${r.desactives.length} compte(s) désactivé(s), leur compte d'annuaire n'existant plus : ${noms}${reste}.`,
    );
    if (r.inscriptionsRetirees > 0) {
      phrases.push(`${r.inscriptionsRetirees} inscription(s) retirée(s), places rendues.`);
    }
    if (r.promotions.length > 0) {
      phrases.push(r.promotions.join(" "));
    }
  } else if (!r.lectureIncomplete) {
    phrases.push("Aucun départ à prendre en compte.");
  }

  if (r.miroirNettoye > 0) {
    phrases.push(`${r.miroirNettoye} fiche(s) d'annuaire obsolète(s) retirée(s) du miroir.`);
  }

  return phrases.join(" ");
}

/**
 * Synchronisation quotidienne, opportuniste — même mécanique que les rappels et
 * la purge. Sans elle, la prise en compte des départs dépendait d'un clic
 * manuel : un agent parti en juin restait actif jusqu'à ce que quelqu'un y
 * pense. Silencieuse : ni l'affichage d'une page ni un cron ne doivent échouer
 * parce que le contrôleur de domaine est momentanément injoignable.
 */
export async function declencherSyncSiBesoin(
  acteur = "synchronisation automatique",
): Promise<ResultatSync | null> {
  try {
    const cfg = await getLdapSettings();
    if (!cfg?.url || !cfg?.baseDn || cfg.enabled === false) return null;
    // Sans compte de service, la lecture en masse est impossible : la
    // synchronisation reste alors un geste manuel, comme avant.
    if (!cfg.bindDn || !cfg.bindPassword) return null;

    const dernier = (await getSetting<number>(CLE_VERROU)) ?? 0;
    if (Date.now() - dernier < INTERVALLE_MS) return null;

    await setSetting(CLE_VERROU, Date.now());
    return await synchroniserAnnuaire(cfg, acteur);
  } catch {
    // le tableau de bord doit s'afficher quoi qu'il arrive
    return null;
  }
}
