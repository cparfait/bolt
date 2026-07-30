import { prisma } from "./db";
import { adresseDeContact } from "./comptes";
import { envoyerMail } from "./mail";
import { getGeneralSettings, getSetting, setSetting } from "./settings";
import { aujourdhui, fmtDateLongue } from "./dates";
import { audit } from "./audit";

/**
 * Rappels de séance envoyés aux inscrits.
 *
 * Déclenchement sans ordonnanceur : Bolt tourne dans un conteneur sans crontab,
 * et ajouter un service dédié pour un mail quotidien serait disproportionné.
 * Le passage d'un utilisateur sur l'application suffit à déclencher la
 * vérification, au plus une fois par intervalle — c'est le mécanisme déjà
 * employé par SimCity pour ses sauvegardes.
 *
 * Une route protégée (`/api/taches/rappels`) permet malgré tout de brancher un
 * vrai cron si la collectivité en dispose : les deux voies sont sûres, le
 * verrou et l'horodatage par séance empêchent tout double envoi.
 */

const CLE_VERROU = "rappels.dernier";
const INTERVALLE_MS = 30 * 60 * 1000; // au plus une vérification par demi-heure

export type ResultatRappels = {
  envoyes: number;
  seances: number;
  ignores: number; // inscrits sans adresse e-mail
  message: string;
};

/**
 * Envoie les rappels dus. Une séance n'est rappelée qu'une fois
 * (`rappelEnvoyeAt`), même si la fonction est appelée en boucle.
 */
export async function envoyerRappels(): Promise<ResultatRappels> {
  const g = await getGeneralSettings();
  if (!g.rappelsActifs) {
    return { envoyes: 0, seances: 0, ignores: 0, message: "Rappels désactivés." };
  }

  const maintenant = new Date();
  const horizon = new Date(maintenant.getTime() + g.rappelHeuresAvant * 3600 * 1000);

  const seances = await prisma.seance.findMany({
    where: {
      statut: "PLANIFIEE",
      rappelEnvoyeAt: null,
      // `date` est un jour calendaire : la borne basse est le jour courant
      // dans le fuseau de la collectivité, et non la date UTC. Entre minuit et
      // 2 h à Paris, celle-ci désigne encore la veille — et une séance d'hier
      // restée non émargée déclenchait un « votre séance a lieu hier ».
      date: { gte: aujourdhui(), lte: horizon },
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
          `Bonjour ${i.user.displayName.split(" ")[0]},`,
          `Petit rappel : votre séance de ${s.creneau.activite.nom} a lieu ${fmtDateLongue(s.date)} de ${s.creneau.heureDebut} à ${s.creneau.heureFin}${s.creneau.lieu ? `, ${s.creneau.lieu}` : ""}.`,
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
 * Déclenchement opportuniste, appelé depuis une page consultée régulièrement.
 * Ne fait rien si la dernière vérification date de moins de 30 minutes.
 * Silencieux et non bloquant : une erreur ici ne doit pas empêcher un
 * gestionnaire d'afficher son tableau de bord.
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
