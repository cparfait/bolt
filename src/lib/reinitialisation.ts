import { prisma } from "./db";

/**
 * Remise à zéro de l'exploitation, paramétrage conservé.
 *
 * Le besoin est celui d'une fin de cycle : la période d'essai s'achève, les
 * activités ont été saisies pour tester, et la collectivité veut repartir de
 * la première inscription réelle — sans refaire le LDAPS, le SMTP, ni le
 * référentiel des services, qui ont demandé des heures et ne dépendent
 * d'aucune saison.
 *
 * D'où la ligne de partage, tenue ici et nulle part ailleurs :
 *
 * | Effacé | Conservé |
 * |---|---|
 * | présences, absences, participations | paramètres (LDAPS, SMTP, général) |
 * | inscriptions et demandes d'accès | référentiel des services et regroupements |
 * | séances, créneaux, activités | déclarations et mentions d'information |
 * | saisons et périodes de fermeture | miroir de l'annuaire (`AdAccount`) |
 * | animateurs, lieux | comptes ADMIN et GESTIONNAIRE |
 * | comptes AGENT et COACH, jetons | |
 * | journal d'audit | |
 *
 * Les comptes qui administrent sont épargnés : les effacer déconnecterait
 * celui qui vient de cliquer, et il faudrait ressortir le compte d'amorçage
 * pour rentrer chez soi. Le miroir de l'annuaire l'est aussi — il n'est pas
 * une donnée d'exploitation mais une copie, que la synchronisation
 * reconstituerait à l'identique dix minutes plus tard.
 *
 * Irréversible et sans sauvegarde préalable : c'est à l'exploitant de faire
 * son instantané de base avant, et l'écran le dit.
 */

export type DecompteReinitialisation = {
  presences: number;
  inscriptions: number;
  seances: number;
  creneaux: number;
  activites: number;
  saisons: number;
  animateurs: number;
  lieux: number;
  comptes: number;
  demandes: number;
  journal: number;
};

/** Ce que la remise à zéro emporterait, tel qu'on l'affiche avant de cliquer. */
export async function compterAReinitialiser(): Promise<DecompteReinitialisation> {
  const [
    presences,
    inscriptions,
    seances,
    creneaux,
    activites,
    saisons,
    animateurs,
    lieux,
    comptes,
    demandes,
    journal,
  ] = await Promise.all([
    prisma.presence.count(),
    prisma.inscription.count(),
    prisma.seance.count(),
    prisma.creneau.count(),
    prisma.activite.count(),
    prisma.saison.count(),
    prisma.coach.count(),
    prisma.lieu.count(),
    prisma.user.count({ where: { role: { in: ["AGENT", "COACH"] } } }),
    prisma.demandeAcces.count(),
    prisma.auditLog.count(),
  ]);
  return {
    presences,
    inscriptions,
    seances,
    creneaux,
    activites,
    saisons,
    animateurs,
    lieux,
    comptes,
    demandes,
    journal,
  };
}

/**
 * Efface les données d'exploitation. Renvoie le décompte de ce qui est parti.
 *
 * Tout en une transaction : une remise à zéro interrompue à mi-chemin
 * laisserait des séances sans saison et des inscriptions sans créneau — un
 * état que rien dans l'application ne sait rattraper, et que personne ne
 * penserait à aller chercher.
 *
 * L'ordre suit les dépendances plutôt que de s'en remettre aux cascades :
 * `Activite → Creneau` est en `Restrict`, et une cascade qui change de règle
 * un jour ne doit pas transformer cette fonction en suppression partielle.
 */
export async function reinitialiser(): Promise<DecompteReinitialisation> {
  const avant = await compterAReinitialiser();

  await prisma.$transaction([
    prisma.presence.deleteMany(),
    prisma.participationPonctuelle.deleteMany(),
    prisma.absenceAnnoncee.deleteMany(),
    prisma.inscription.deleteMany(),
    prisma.seance.deleteMany(),
    prisma.creneau.deleteMany(),
    prisma.fermeture.deleteMany(),
    prisma.saison.deleteMany(),
    prisma.activite.deleteMany(),
    prisma.coach.deleteMany(),
    prisma.demandeAcces.deleteMany(),
    prisma.magicToken.deleteMany(),
    prisma.user.deleteMany({ where: { role: { in: ["AGENT", "COACH"] } } }),
    prisma.lieu.deleteMany(),
    // Le journal en dernier : les suppressions ci-dessus n'y écrivent rien,
    // mais la ligne qui documente CETTE remise à zéro est posée après la
    // transaction — elle doit survivre au vidage.
    prisma.auditLog.deleteMany(),
  ]);

  return avant;
}
