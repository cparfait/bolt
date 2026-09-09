import { prisma } from "./db";
import { adresseDeContact } from "./comptes";
import { ouvrirMessagerie } from "./mail";
import {
  DEFAULT_GENERAL,
  getGeneralSettings,
  getSetting,
  setSetting,
  type GeneralSettings,
} from "./settings";
import {
  ajouterJours,
  aujourdhui,
  fmtDateLongue,
  fmtHeure,
  heureCourante,
  normaliserHeure,
} from "./dates";
import { nomPourSalutation } from "./constants";
import { lienAbsence } from "./liens-courriel";
import { adressesDesLieux, itineraireDe } from "./lieux";
import { audit } from "./audit";
import { rateLimit } from "./rate-limit";

/**
 * Rappels de séance envoyés aux inscrits.
 *
 * Déclenchement : l'ordonnanceur interne au conteneur
 * (`src/lib/ordonnanceur.ts`), qui bat toutes les cinq minutes que quelqu'un
 * soit connecté ou non. Une route protégée (`/api/taches/rappels`) permet en
 * plus de brancher un ordonnanceur externe : les deux voies sont sûres, le
 * verrou et la remise notée par inscrit empêchent tout double envoi.
 *
 * L'envoi a un rendez-vous — la veille à midi, par défaut — et non une fenêtre
 * d'anticipation : voir `rappelJoursAvant` (src/lib/settings.ts) pour ce que
 * cela change du point de vue de l'agent.
 *
 * ── Une remise à la fois, et la campagne reprend là où elle s'arrête ──────
 *
 * Chaque inscrit reçoit son propre message, cadencé (src/lib/mail.ts,
 * `MESSAGES_PAR_MINUTE`) : Microsoft 365 plafonne les soumissions SMTP à
 * trente par minute, et une boucle sans cadence voyait tout refuser à partir
 * du trente-et-unième — la séance se marquait pourtant « rappelée ».
 *
 * Chaque remise s'écrit (`RappelEnvoye`). Au premier refus de la messagerie
 * — débit, authentification, réseau — la campagne s'interrompt, sans marquer
 * la séance ; le passage suivant, cinq minutes plus tard, reprend avec ceux
 * qui manquent. Seul un destinataire rejeté pour lui-même (adresse inconnue)
 * n'est pas retenté : la ligne garde la raison. Une messagerie durablement en
 * panne fait donc retenter la séance à chaque passage, jusqu'à sa date : c'est
 * voulu — un rappel parti à 15 h vaut mieux qu'un rappel jamais parti.
 */

const CLE_VERROU = "rappels.dernier";
// Au plus une vérification par tranche de cinq minutes — la période de
// l'ordonnanceur (src/lib/ordonnanceur.ts). Ce verrou protège d'un
// ordonnanceur externe mal réglé qui appellerait la route en boucle ; le
// garde-fou contre un double envoi reste `RappelEnvoye`, posé par inscrit.
const INTERVALLE_MS = 5 * 60 * 1000;

export type ResultatRappels = {
  envoyes: number;
  seances: number; // séances dont la campagne est terminée à ce passage
  ignores: number; // inscrits sans adresse e-mail
  refuses: number; // destinataires rejetés par la messagerie, non retentés
  /** La messagerie a cessé de servir : ce qui reste partira au passage suivant. */
  interrompu?: string;
  message: string;
};

/**
 * Une seule campagne à la fois dans ce processus. Cadencée, une campagne peut
 * durer plus que les cinq minutes du verrou en base : sans ce témoin, le
 * battement suivant repartirait sur les mêmes séances, et les messages en
 * cours d'envoi — pas encore inscrits dans `RappelEnvoye` — partiraient deux
 * fois. Porté par `globalThis` pour survivre aux rechargements à chaud, comme
 * le minuteur de l'ordonnanceur.
 */
const TEMOIN = Symbol.for("bolt.rappels.enCours");
type PorteurTemoin = { [TEMOIN]?: boolean };

/** Réglage d'envoi, normalisé : l'heure vient d'un champ de saisie. */
export function heureDEnvoi(g: Pick<GeneralSettings, "rappelHeure">): string {
  return normaliserHeure(g.rappelHeure) ?? DEFAULT_GENERAL.rappelHeure;
}

/**
 * Jusqu'à quelle date les séances sont rappelées en ce moment — `null` tant
 * que l'heure d'envoi n'est pas venue.
 *
 * Séparée de l'envoi pour être vérifiable sans base ni messagerie : c'est la
 * seule partie du mécanisme où une erreur ne se voit pas (un rappel parti trop
 * tôt reste un rappel, et personne ne signale celui qui n'est jamais parti).
 *
 * La borne haute est un jour calendaire, comme `Seance.date`. La borne basse
 * est le jour courant chez la collectivité et non la date UTC : entre minuit
 * et 2 h à Paris, celle-ci désigne encore la veille — et une séance d'hier
 * restée non émargée déclenchait un « votre séance a lieu hier ».
 *
 * Toutes les séances jusqu'à la borne, et pas seulement celles du jour visé :
 * si l'application est restée éteinte, ou le réglage activé ce matin, ce qui
 * n'a pas été rappelé part au premier passage plutôt que de ne partir jamais.
 */
export function borneDesRappels(
  g: Pick<GeneralSettings, "rappelJoursAvant" | "rappelHeure">,
  maintenant: Date = new Date(),
): Date | null {
  if (heureCourante(maintenant) < heureDEnvoi(g)) return null;
  const jours = Math.max(0, Math.min(7, Math.round(g.rappelJoursAvant)));
  return ajouterJours(aujourdhui(maintenant), jours);
}

/**
 * Envoie les rappels dus. Chaque inscrit n'est rappelé qu'une fois
 * (`RappelEnvoye`), même si la fonction est appelée en boucle.
 */
export async function envoyerRappels(): Promise<ResultatRappels> {
  const porteur = globalThis as PorteurTemoin;
  if (porteur[TEMOIN]) {
    return { ...VIDE, message: "Une campagne de rappels est déjà en cours." };
  }
  porteur[TEMOIN] = true;
  try {
    return await campagne();
  } finally {
    porteur[TEMOIN] = false;
  }
}

const VIDE = { envoyes: 0, seances: 0, ignores: 0, refuses: 0 };

async function campagne(): Promise<ResultatRappels> {
  const g = await getGeneralSettings();
  if (!g.rappelsActifs) {
    return { ...VIDE, message: "Rappels désactivés." };
  }

  const borne = borneDesRappels(g);
  if (!borne) {
    return {
      ...VIDE,
      message: `Rien à envoyer : les rappels partent à ${fmtHeure(heureDEnvoi(g))}.`,
    };
  }

  const seances = await prisma.seance.findMany({
    where: {
      statut: "PLANIFIEE",
      rappelEnvoyeAt: null,
      date: { gte: aujourdhui(), lte: borne },
    },
    include: {
      creneau: {
        include: {
          activite: true,
          inscriptions: {
            // Un compte désactivé sans désinscription — congé long, absence
            // prolongée — garde sa place, mais n'a pas à recevoir de rappel.
            where: { statut: "VALIDEE", user: { active: true } },
            include: { user: true },
          },
        },
      },
      // Un agent qui a prévenu de son absence n'a pas besoin qu'on lui rappelle
      // la séance à laquelle il vient de dire qu'il ne viendrait pas.
      absences: { select: { userId: true } },
      // Ce qui est déjà parti — ou définitivement refusé — à un passage précédent.
      rappels: { select: { userId: true } },
    },
    orderBy: { date: "asc" },
    take: 50, // garde-fou : jamais plus de 50 séances par passage
  });
  if (seances.length === 0) return { ...VIDE, message: "Aucun rappel à envoyer." };

  // Nom public de l'application : la page qui porte le bouton est joignable
  // depuis Internet, comme la feuille d'émargement, et c'est exactement là que
  // le rappel se lit. Sans adresse configurée, le message part sans bouton
  // plutôt qu'avec un lien qui ne mène nulle part.
  const base = g.pointageUrl || g.appUrl;

  const bilan = { ...VIDE };
  let interrompu: string | undefined;

  const adresses = await adressesDesLieux();
  const messagerie = await ouvrirMessagerie();
  try {
    for (const s of seances) {
      const itineraire = itineraireDe(s.creneau.lieu, adresses);
      const aEcarter = new Set([
        ...s.absences.map((a) => a.userId),
        ...s.rappels.map((r) => r.userId),
      ]);
      for (const i of s.creneau.inscriptions) {
        if (aEcarter.has(i.userId)) continue;
        const adresse = adresseDeContact(i.user);
        if (!adresse) {
          bilan.ignores += 1;
          continue;
        }
        const res = await messagerie.envoyer(
          adresse,
          `Rappel — ${s.creneau.activite.nom} ${fmtDateLongue(s.date)}`,
          [
            `Bonjour ${nomPourSalutation(i.user.displayName)},`,
            `Petit rappel : votre séance de ${s.creneau.activite.nom} a lieu **${fmtDateLongue(s.date)} de ${s.creneau.heureDebut} à ${s.creneau.heureFin}**${s.creneau.lieu ? `, **${s.creneau.lieu}**` : ""}.`,
            // Un bouton, et non « prévenez le service des sports » : le rappel se
            // lit sur un téléphone, et prévenir par courriel demandait d'ouvrir un
            // nouveau message, de trouver quoi écrire et à qui. Personne ne le
            // faisait, l'animateur attendait, et la place restait perdue.
            `Un empêchement ? Signalez-le d'un clic : votre place profitera à un collègue en liste d'attente, et l'animateur ne vous attendra pas.`,
            base ? `[Je ne pourrai pas venir](${lienAbsence(s.id, i.userId, base)})` : null,
            // Dans une phrase et non seul sur sa ligne : le gabarit n'en fait
            // alors pas un second bouton, qui concurrencerait le premier.
            itineraire ? `Pour vous y rendre : [itinéraire vers ${s.creneau.lieu}](${itineraire}).` : null,
            g.contactEmail ? `Le service des sports — ${g.contactEmail}` : `Le service des sports`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
        if (!res.ok && !res.destinataireRefuse) {
          // La messagerie ne sert plus : inutile d'insister, chaque message
          // suivant échouerait de même. Le passage suivant reprendra ici.
          interrompu = res.message;
          break;
        }
        await prisma.rappelEnvoye.create({
          data: { seanceId: s.id, userId: i.userId, erreur: res.ok ? null : res.message },
        });
        if (res.ok) bilan.envoyes += 1;
        else bilan.refuses += 1;
      }
      if (interrompu) break;
      // Terminée : tous les inscrits joignables ont leur ligne.
      await prisma.seance.update({
        where: { id: s.id },
        data: { rappelEnvoyeAt: new Date() },
      });
      bilan.seances += 1;
    }
  } finally {
    messagerie.fermer();
  }

  if (bilan.envoyes > 0 || bilan.refuses > 0) {
    await audit("RAPPELS_ENVOYES", {
      details:
        `${bilan.envoyes} message(s), ${bilan.seances} séance(s) terminée(s)` +
        (bilan.refuses > 0 ? `, ${bilan.refuses} adresse(s) refusée(s)` : "") +
        (interrompu ? ` — interrompu : ${interrompu}` : ""),
    });
  } else if (interrompu && rateLimit("rappels:interruption", 1, 3600).ok) {
    // Rien n'est parti et la messagerie refuse : une ligne par heure suffit à
    // le faire savoir sans remplir le journal toutes les cinq minutes.
    await audit("RAPPELS_INTERROMPUS", { details: interrompu });
  }

  const reste = seances.length - bilan.seances;
  return {
    ...bilan,
    interrompu,
    message: interrompu
      ? `${bilan.envoyes} rappel(s) envoyé(s), puis la messagerie a refusé : ${interrompu} — ${reste} séance(s) seront reprises au prochain passage.`
      : `${bilan.envoyes} rappel(s) envoyé(s) pour ${bilan.seances} séance(s)` +
        (bilan.ignores > 0 ? `, ${bilan.ignores} agent(s) sans adresse e-mail` : "") +
        (bilan.refuses > 0 ? `, ${bilan.refuses} adresse(s) refusée(s) par la messagerie` : "") +
        ".",
  };
}

/**
 * Appelé par l'ordonnanceur interne (src/lib/ordonnanceur.ts) et par la route
 * de cron. Ne fait rien si la dernière vérification est trop récente.
 * Silencieux : une erreur ici ne doit rien interrompre.
 */
export async function declencherRappelsSiBesoin(): Promise<void> {
  try {
    const g = await getGeneralSettings();
    if (!g.rappelsActifs) return;

    const dernier = (await getSetting<number>(CLE_VERROU)) ?? 0;
    if (Date.now() - dernier < INTERVALLE_MS) return;

    // Pose du verrou avant l'envoi : deux requêtes simultanées ne déclencheront
    // pas deux campagnes. L'horodatage par séance reste le garde-fou ultime.
    await setSetting(CLE_VERROU, Date.now());
    await envoyerRappels();
  } catch {
    // le tableau de bord doit s'afficher quoi qu'il arrive
  }
}
