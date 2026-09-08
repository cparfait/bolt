import { prisma } from "./db";
import { adresseDeContact } from "./comptes";
import { envoyerMail } from "./mail";
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
import { audit } from "./audit";

/**
 * Rappels de séance envoyés aux inscrits.
 *
 * Déclenchement : l'ordonnanceur interne au conteneur
 * (`src/lib/ordonnanceur.ts`), qui bat toutes les cinq minutes que quelqu'un
 * soit connecté ou non. Une route protégée (`/api/taches/rappels`) permet en
 * plus de brancher un ordonnanceur externe : les deux voies sont sûres, le
 * verrou et l'horodatage par séance empêchent tout double envoi.
 *
 * L'envoi a un rendez-vous — la veille à midi, par défaut — et non une fenêtre
 * d'anticipation : voir `rappelJoursAvant` (src/lib/settings.ts) pour ce que
 * cela change du point de vue de l'agent.
 */

const CLE_VERROU = "rappels.dernier";
// Au plus une vérification par tranche de cinq minutes — la période de
// l'ordonnanceur (src/lib/ordonnanceur.ts). Ce verrou protège d'un
// ordonnanceur externe mal réglé qui appellerait la route en boucle ; le
// garde-fou contre un double envoi reste `rappelEnvoyeAt`, posé par séance.
const INTERVALLE_MS = 5 * 60 * 1000;

export type ResultatRappels = {
  envoyes: number;
  seances: number;
  ignores: number; // inscrits sans adresse e-mail
  message: string;
};

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
 * Envoie les rappels dus. Une séance n'est rappelée qu'une fois
 * (`rappelEnvoyeAt`), même si la fonction est appelée en boucle.
 */
export async function envoyerRappels(): Promise<ResultatRappels> {
  const g = await getGeneralSettings();
  if (!g.rappelsActifs) {
    return { envoyes: 0, seances: 0, ignores: 0, message: "Rappels désactivés." };
  }

  const borne = borneDesRappels(g);
  if (!borne) {
    return {
      envoyes: 0,
      seances: 0,
      ignores: 0,
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
            where: { statut: "VALIDEE" },
            include: { user: true },
          },
        },
      },
      // Un agent qui a prévenu de son absence n'a pas besoin qu'on lui rappelle
      // la séance à laquelle il vient de dire qu'il ne viendrait pas.
      absences: { select: { userId: true } },
    },
    take: 50, // garde-fou : jamais plus de 50 séances par passage
  });

  let envoyes = 0;
  let ignores = 0;

  for (const s of seances) {
    const prevenus = new Set(s.absences.map((a) => a.userId));
    for (const i of s.creneau.inscriptions) {
      if (prevenus.has(i.userId)) continue;
      const adresse = adresseDeContact(i.user);
      if (!adresse) {
        ignores += 1;
        continue;
      }
      const res = await envoyerMail(
        adresse,
        `Rappel — ${s.creneau.activite.nom} ${fmtDateLongue(s.date)}`,
        [
          `Bonjour ${nomPourSalutation(i.user.displayName)},`,
          `Petit rappel : votre séance de ${s.creneau.activite.nom} a lieu **${fmtDateLongue(s.date)} de ${s.creneau.heureDebut} à ${s.creneau.heureFin}**${s.creneau.lieu ? `, **${s.creneau.lieu}**` : ""}.`,
          `Un empêchement ? Prévenez le service des sports : votre place profitera à un collègue en liste d'attente.`,
          g.contactEmail ? `Le service des sports — ${g.contactEmail}` : `Le service des sports`,
        ].join("\n\n"),
      );
      if (res.ok) envoyes += 1;
    }
    // Marquée même si aucun envoi n'a abouti : sans cela, une messagerie en
    // panne ferait réexpédier la séance à chaque passage.
    await prisma.seance.update({
      where: { id: s.id },
      data: { rappelEnvoyeAt: new Date() },
    });
  }

  if (seances.length > 0) {
    await audit("RAPPELS_ENVOYES", {
      details: `${envoyes} message(s) pour ${seances.length} séance(s)`,
    });
  }

  return {
    envoyes,
    seances: seances.length,
    ignores,
    message:
      seances.length === 0
        ? "Aucun rappel à envoyer."
        : `${envoyes} rappel(s) envoyé(s) pour ${seances.length} séance(s)${ignores > 0 ? `, ${ignores} agent(s) sans adresse e-mail` : ""}.`,
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
