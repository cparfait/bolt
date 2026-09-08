import { prisma } from "./db";

/**
 * Le journal, lu depuis une fiche d'agent.
 *
 * Deux questions s'y posent, et le modèle n'en portait qu'une : « qu'a fait
 * cette personne ? » se lit sur `AuditLog.userId`, l'acteur. « Que lui a-t-on
 * fait ? » — qui l'a retirée de son créneau, quand son accès a été fermé, qui a
 * corrigé son service — n'était nulle part, la personne concernée ne figurant
 * qu'en toutes lettres dans `cible`. D'où `cibleId` (prisma/schema.prisma), et
 * cette lecture qui réunit les deux.
 *
 * Rien n'y est réservé à l'ADMIN : c'est le même journal que Paramètres →
 * Journal, restreint à une personne, et le service des sports en a besoin pour
 * répondre à « pourquoi ne suis-je plus inscrit ? » sans appeler la DSI. Les
 * adresses IP, elles, restent sur l'écran d'administration — elles ne servent à
 * rien ici et sont ce que le journal contient de plus sensible.
 */

/**
 * Le code d'action tel qu'on le montre à quelqu'un qui n'a pas écrit
 * l'application. `INSCRIPTION_EN_ATTENTE` se comprend au bout d'un moment ;
 * « Placé en liste d'attente » se lit du premier coup, et c'est un écran de
 * consultation, pas un écran de diagnostic.
 *
 * Un code absent de cette table s'affiche tel quel : mieux vaut un libellé
 * technique qu'une ligne qui disparaît parce que personne n'a pensé à la
 * traduire.
 */
const LIBELLES: Record<string, string> = {
  CONNEXION: "Connexion",
  CONNEXION_PREMIERE: "Première connexion",
  CONNEXION_LIEN: "Connexion par lien e-mail",
  CONNEXION_ECHEC: "Échec de connexion",
  CONNEXION_BLOQUEE: "Connexion bloquée",
  CONNEXION_HORS_RESEAU: "Connexion refusée hors réseau",
  LIEN_MAGIQUE_ENVOYE: "Lien de connexion envoyé",
  LIEN_MAGIQUE_ECHEC: "Lien de connexion non envoyé",
  ACCES_ANNONCE: "Ouverture d'accès annoncée",
  ACCES_ANNONCE_ECHEC: "Annonce d'accès non envoyée",
  DEMANDE_ACCES_VALIDEE: "Demande d'accès validée",
  DEMANDE_ACCES_REFUSEE: "Demande d'accès refusée",
  INSCRIPTION_DEMANDE: "Demande d'inscription",
  INSCRIPTION_VALIDEE: "Inscription validée",
  INSCRIPTION_EN_ATTENTE: "Placé en liste d'attente",
  INSCRIPTION_REFUSEE: "Inscription refusée",
  INSCRIPTION_DESISTEE: "Désistement",
  INSCRIPTION_MANUELLE: "Inscrit par le service",
  INSCRIPTION_PROMUE: "Promu depuis la liste d'attente",
  INSCRIPTION_DEPUIS_SEANCE: "Inscrit depuis une feuille d'émargement",
  ABSENCE_ANNONCEE: "Absence annoncée",
  ABSENCE_ANNULEE: "Absence retirée",
  COMPTE_DESACTIVE: "Accès fermé",
  COMPTE_ACTIVE: "Accès rouvert",
  COMPTE_ANONYMISE: "Identité supprimée",
  ROLE_MODIFIE: "Rôle modifié",
  AGENT_EMAIL_MODIFIE: "Adresse de contact modifiée",
  AGENT_SERVICE_MODIFIE: "Service modifié",
  AGENT_RATTACHE_AD: "Rattaché à l'annuaire",
  AGENT_FUSIONNE_AD: "Fiches fusionnées",
  AGENT_HORS_ANNUAIRE_CREE: "Compte créé hors annuaire",
};

export function libelleAction(action: string): string {
  return LIBELLES[action] ?? action;
}

export type LigneJournal = {
  id: string;
  quand: Date;
  action: string;
  libelle: string;
  /** Qui a agi, ou null quand c'est la personne elle-même. */
  acteur: string | null;
  cible: string | null;
  details: string | null;
};

/**
 * Les dernières lignes concernant une personne, qu'elle en soit l'auteur ou
 * l'objet. `acteur` est laissé nul quand c'est elle qui a agi : l'écran est déjà
 * le sien, répéter son nom sur chaque ligne noierait les quelques-unes où
 * quelqu'un d'autre est intervenu — précisément celles qu'on vient chercher.
 */
export async function journalDe(userId: string, limite = 25): Promise<LigneJournal[]> {
  const lignes = await prisma.auditLog.findMany({
    where: { OR: [{ userId }, { cibleId: userId }] },
    include: { user: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" },
    take: limite,
  });
  return lignes.map((l) => ({
    id: l.id,
    quand: l.createdAt,
    action: l.action,
    libelle: libelleAction(l.action),
    acteur: l.userId === userId ? null : (l.user?.displayName ?? l.acteur),
    cible: l.cible,
    details: l.details,
  }));
}
