import { prisma } from "./db";
import { promouvoirEtPrevenir, renumeroterFile } from "./inscriptions";
import { PREFIXE_HORS_ANNUAIRE } from "./comptes";
import { aujourdhui } from "./dates";
import { audit } from "./audit";

/**
 * Départs : désactivation d'un compte et retrait de ses activités.
 *
 * Un même geste, appelé de trois endroits — la fiche agent (le service des
 * sports sait qu'une personne est partie), la table des utilisateurs (la DSI
 * ferme un accès) et la synchronisation de l'annuaire (l'AD dit que le compte
 * n'existe plus). Réunir la logique ici évite trois comportements qui
 * divergeraient à la première correction.
 *
 * DÉSINSCRIRE, PAS SUPPRIMER. L'inscription passe en DESISTEE — le statut prévu
 * pour « s'est désinscrit ou a été retiré » — au lieu d'être effacée de la base.
 * La place est rendue et la personne ne figure plus nulle part comme inscrite,
 * ce qui est le résultat attendu ; mais les présences déjà émargées gardent leur
 * rattachement, et la fréquentation des séances passées reste juste. Supprimer
 * les lignes ferait mentir les statistiques de la saison écoulée — or c'est
 * précisément ce que cette application existe pour produire.
 */

/** Statuts qui réservent une place ou attendent un arbitrage. */
const STATUTS_VIVANTS = ["VALIDEE", "EN_ATTENTE", "LISTE_ATTENTE"] as const;

/** Inscriptions encore vivantes d'un agent : ce qu'un départ va retirer. */
export async function compterInscriptionsVivantes(userId: string): Promise<number> {
  return prisma.inscription.count({
    where: { userId, statut: { in: [...STATUTS_VIVANTS] } },
  });
}

export type ResultatDepart = {
  inscriptionsRetirees: number;
  /** Fragments de compte rendu des places reprises par la liste d'attente. */
  promotions: string[];
};

/**
 * Retire un agent de toutes ses activités et rend ses places.
 *
 * Les séances à venir où il était attendu ponctuellement sont nettoyées aussi :
 * sans cela, il resterait sur les feuilles d'émargement des semaines suivantes,
 * et l'animateur chercherait quelqu'un qui ne viendra pas. Les absences
 * annoncées et les présences déjà constatées, elles, ne sont pas touchées : ce
 * sont des faits datés.
 */
export async function desinscrireDeTout(
  userId: string,
  acteur: string,
  motif: string,
): Promise<ResultatDepart> {
  const inscriptions = await prisma.inscription.findMany({
    where: { userId, statut: { in: [...STATUTS_VIVANTS] } },
    include: { creneau: { include: { activite: { select: { nom: true } } } } },
  });

  const promotions: string[] = [];
  for (const i of inscriptions) {
    await prisma.inscription.update({
      where: { id: i.id },
      data: {
        statut: "DESISTEE",
        rang: null,
        decisionAt: new Date(),
        decidePar: acteur,
        motif,
      },
    });
    await renumeroterFile(i.creneauId);
    // Une place libérée profite au suivant, exactement comme sur un
    // désistement : c'est le même événement, vu de la liste d'attente.
    const promu = await promouvoirEtPrevenir(i.creneauId);
    if (promu) promotions.push(promu.trim());
  }

  await prisma.participationPonctuelle.deleteMany({
    where: { userId, seance: { date: { gte: aujourdhui() } } },
  });

  return { inscriptionsRetirees: inscriptions.length, promotions };
}

export type ResultatDesactivation = ResultatDepart & {
  /** Faux si le compte était déjà inactif : rien n'a été fait. */
  applique: boolean;
  nom: string;
};

/**
 * Désactive un compte, et retire ses activités si on le demande.
 *
 * Le retrait est facultatif : une désactivation temporaire — congé longue durée,
 * mutation en cours d'instruction — n'a pas de raison de faire perdre à
 * quelqu'un une place qu'il retrouvera. Un vrai départ, oui.
 */
export async function desactiverCompte(
  userId: string,
  options: { acteur: string; desinscrire: boolean; motif: string },
): Promise<ResultatDesactivation> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { applique: false, nom: "", inscriptionsRetirees: 0, promotions: [] };
  }

  const depart = options.desinscrire
    ? await desinscrireDeTout(userId, options.acteur, options.motif)
    : { inscriptionsRetirees: 0, promotions: [] };

  if (user.active) {
    await prisma.user.update({ where: { id: userId }, data: { active: false } });
  }

  await audit("COMPTE_DESACTIVE", {
    acteur: options.acteur,
    cible: user.login,
    details: options.desinscrire
      ? `${options.motif} — ${depart.inscriptionsRetirees} inscription(s) retirée(s)`
      : options.motif,
  });

  return { applique: true, nom: user.displayName, ...depart };
}

/**
 * Un compte Bolt est-il adossé à l'Active Directory ?
 *
 * Décisif pour la synchronisation : elle ne doit toucher QUE ces comptes. Les
 * comptes locaux (administrateur de secours, animateurs en accès LOCAL) et les
 * participants hors annuaire (élus, stagiaires, invités d'un organisme
 * partenaire) n'ont légitimement aucune existence dans l'AD — les désactiver
 * parce qu'ils en sont absents effacerait la moitié des participants à la
 * première synchro.
 */
export function adosseALAnnuaire(user: { isLocal: boolean; login: string }): boolean {
  return !user.isLocal && !user.login.toLowerCase().startsWith(PREFIXE_HORS_ANNUAIRE);
}
