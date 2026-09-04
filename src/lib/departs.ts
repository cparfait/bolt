import { prisma } from "./db";
import { promouvoirEtPrevenir, renumeroterFile } from "./inscriptions";
import { estCreeALaMain } from "./comptes";
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
 *
 * S'appuie sur `estCreeALaMain`, qui reconnaît aussi l'ancien préfixe « ext. » :
 * ici l'erreur ne se pardonne que dans un sens, et mieux vaut oublier de fermer
 * un accès que retirer ses activités à quelqu'un qui n'est pas parti.
 */
export function adosseALAnnuaire(user: { isLocal: boolean; login: string }): boolean {
  return !user.isLocal && !estCreeALaMain(user.login);
}

/**
 * Efface l'identité d'un agent, sans effacer sa fréquentation.
 *
 * SUPPRIMER LA LIGNE N'EST PAS UNE OPTION. `Inscription` et `Presence` sont en
 * CASCADE sur `User` : un DELETE emporterait toutes ses venues, et le bilan de
 * fréquentation des saisons passées — ce que cette application existe pour
 * produire — se mettrait à mentir rétroactivement, sans que rien ne le signale.
 *
 * On efface donc ce qui désigne la personne : nom, identifiant, adresses, mot
 * de passe. Ce qui reste ne désigne plus personne — un rattachement direction /
 * service, et des liens vers des séances. C'est exactement ce qu'il faut pour
 * les statistiques, et c'est le sens de l'anonymisation au regard du RGPD :
 * la donnée n'est plus personnelle, donc elle n'a plus de durée de conservation
 * à respecter.
 *
 * Le rattachement hiérarchique est conservé volontairement : « combien d'agents
 * de la direction des sports ont pratiqué cette saison » reste une question
 * légitime, et la réponse ne réidentifie personne dès lors que le nom est parti.
 * Sur un service d'une seule personne, elle le réidentifierait — d'où le choix
 * de ne PAS conserver le service quand il ne compte qu'un agent anonymisé.
 */
export async function anonymiserCompte(
  userId: string,
  auteur: string,
): Promise<{ applique: boolean; nom: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.anonymiseAt) return { applique: false, nom: user?.displayName ?? "" };

  const nom = user.displayName;

  // Les places d'abord : une identité effacée qui occuperait encore un créneau
  // laisserait une ligne « Agent supprimé » sur les feuilles à venir.
  await desinscrireDeTout(userId, auteur, "compte supprimé");

  // Identifiant neutre, unique, et impossible à confondre avec un
  // sAMAccountName ou un participant hors annuaire : la synchronisation de
  // l'annuaire ne doit jamais rattacher ce compte à quoi que ce soit.
  const login = `supprime.${userId.slice(-12)}`;

  await prisma.$transaction([
    // Les jetons de connexion en cours cessent d'ouvrir quoi que ce soit.
    prisma.magicToken.deleteMany({ where: { userId } }),
    // Une fiche d'animateur qui pointerait sur ce compte le perd.
    prisma.coach.updateMany({ where: { userId }, data: { userId: null } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        login,
        displayName: "Agent supprimé",
        email: null,
        emailContact: null,
        passwordHash: null,
        active: false,
        anonymiseAt: new Date(),
      },
    }),
  ]);

  await audit("COMPTE_ANONYMISE", { cible: nom, details: `par ${auteur}` });
  return { applique: true, nom };
}
