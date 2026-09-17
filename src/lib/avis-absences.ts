import { prisma } from "./db";
import { adresseDeContact } from "./comptes";
import { nomPourSalutation } from "./constants";
import {
  aujourdhui,
  fmtDateLongue,
  heureEntiereCourante,
  isoDate,
  JOUR_LABELS,
} from "./dates";
import { participeALaSeance } from "./inscriptions";
import { lienDesinscription } from "./liens-courriel";
import { ouvrirMessagerie } from "./mail";
import { getGeneralSettings, getSetting, setSetting } from "./settings";
import { estPresent } from "./stats";
import { audit } from "./audit";

/**
 * « On ne vous voit plus » — courriel automatique après des absences répétées.
 *
 * Le service des sports disposait déjà de la liste des agents qui ne viennent
 * plus (statistiques, « décrocheurs ») et d'un bouton pour les relancer à la
 * main. En pratique, la page se consulte au bilan, pas chaque semaine : un
 * agent qui avait lâché en octobre occupait sa place jusqu'aux vacances de
 * Noël pendant que la file d'attente attendait, et la relance arrivait quand
 * il n'y avait plus rien à récupérer.
 *
 * Le même seuil que cette liste (`absencesAvantRelance`) et la même règle de
 * comptage — les dernières séances émargées de son créneau, depuis son
 * inscription, sans une seule présence — pour qu'un agent prévenu ici soit
 * exactement celui que le service voit sur l'écran. Le courriel prévient, et
 * propose de libérer sa place d'un clic ; il ne retire personne.
 *
 * ── Un avis par série ─────────────────────────────────────────────────────
 *
 * Chaque envoi s'écrit (`AvisAbsences`) avec la séance la plus récente de la
 * série. Tant que cette séance fait partie de la série courante — l'agent n'est
 * pas revenu depuis —, il n'y a rien à redire : une quatrième, puis une
 * cinquième absence ne font pas partir de second message. S'il revient puis
 * décroche à nouveau, la nouvelle série a droit au sien.
 *
 * Même mécanique d'envoi que les rappels (src/lib/rappels.ts) : cadencé, une
 * ligne par remise, et la campagne s'interrompt au premier refus de la
 * messagerie pour reprendre au passage suivant.
 */

const CLE_DERNIER_PASSAGE = "avis-absences:dernierJour";

/**
 * La série d'absences en cours, de la plus récente à la plus ancienne :
 * les séances émargées jusqu'à la première où l'agent était présent.
 *
 * `recentes` est ordonnée de la plus récente à la plus ancienne. Une séance
 * émargée où l'agent n'a pas de ligne compte comme une absence — la feuille a
 * été faite, il n'y figure pas —, comme pour la liste des décrocheurs.
 *
 * Pure et exportée pour être testée seule : c'est la règle qui décide qui
 * reçoit un courriel lui disant qu'on ne le voit plus.
 */
export function serieDAbsences(recentes: { id: string; present: boolean }[]): string[] {
  const serie: string[] = [];
  for (const s of recentes) {
    if (s.present) break;
    serie.push(s.id);
  }
  return serie;
}

/**
 * Un avis est-il dû pour cette série ? Le seuil est atteint, et aucun avis
 * déjà remis ne porte sur une séance de la série — sinon l'agent a déjà été
 * prévenu pour celle-ci.
 */
export function avisDu(
  serie: string[],
  seuil: number,
  avisPrecedents: { seanceId: string }[],
): boolean {
  if (seuil < 1 || serie.length < seuil) return false;
  return !avisPrecedents.some((a) => serie.includes(a.seanceId));
}

export type ResultatAvisAbsences = {
  envoyes: number;
  refuses: number; // destinataires rejetés par la messagerie, non retentés
  ignores: number; // inscrits sans adresse e-mail
  /** La messagerie a cessé de servir : ce qui reste partira au passage suivant. */
  interrompu?: string;
  message: string;
};

const VIDE = { envoyes: 0, refuses: 0, ignores: 0 };

/** Envoie les avis dus. Chaque série d'absences n'est signalée qu'une fois. */
export async function envoyerAvisAbsences(): Promise<ResultatAvisAbsences> {
  const g = await getGeneralSettings();
  if (!g.avisAbsencesActif) {
    return { ...VIDE, message: "Courriel après absences répétées désactivé." };
  }
  const seuil = Math.max(1, g.absencesAvantRelance);

  const inscriptions = await prisma.inscription.findMany({
    where: {
      statut: "VALIDEE",
      // Un compte désactivé n'a plus de boîte à lire, et une activité fermée
      // ou un créneau retiré n'ont plus de place à libérer.
      user: { active: true },
      creneau: {
        archiveAt: null,
        saison: { active: true },
        activite: { actif: true, archiveAt: null },
      },
    },
    select: {
      id: true,
      userId: true,
      creneauId: true,
      decisionAt: true,
      demandeAt: true,
      user: { select: { id: true, displayName: true, email: true, emailContact: true } },
      creneau: {
        select: {
          jour: true,
          heureDebut: true,
          heureFin: true,
          lieu: true,
          activite: { select: { nom: true } },
        },
      },
      avisAbsences: { select: { seanceId: true } },
    },
  });
  if (inscriptions.length === 0) return { ...VIDE, message: "Aucun inscrit à examiner." };

  const creneauIds = [...new Set(inscriptions.map((i) => i.creneauId))];
  const seances = await prisma.seance.findMany({
    where: { creneauId: { in: creneauIds }, statut: "FAITE", date: { lte: aujourdhui() } },
    select: {
      id: true,
      creneauId: true,
      date: true,
      presences: { select: { userId: true, etat: true } },
    },
    orderBy: { date: "desc" },
  });
  const parCreneau = new Map<string, typeof seances>();
  for (const s of seances) {
    parCreneau.set(s.creneauId, [...(parCreneau.get(s.creneauId) ?? []), s]);
  }

  const aPrevenir: { inscription: (typeof inscriptions)[number]; serie: string[]; derniere: Date }[] =
    [];
  for (const i of inscriptions) {
    // Seules comptent les séances depuis son inscription : un arrivant récent
    // n'a pas manqué celles qui ont eu lieu avant lui.
    const recentes = (parCreneau.get(i.creneauId) ?? []).filter((s) =>
      participeALaSeance(i, s.date),
    );
    const serie = serieDAbsences(
      recentes.map((s) => ({
        id: s.id,
        present: s.presences.some((p) => p.userId === i.userId && estPresent(p.etat)),
      })),
    );
    if (!avisDu(serie, seuil, i.avisAbsences)) continue;
    aPrevenir.push({ inscription: i, serie, derniere: recentes[0].date });
  }
  if (aPrevenir.length === 0) {
    return { ...VIDE, message: `Personne n'a atteint ${seuil} absences consécutives sans avoir été prévenu.` };
  }

  // Nom public de l'application : la page qui porte le bouton est joignable
  // depuis Internet, comme celles des autres courriels. Sans adresse, le
  // message part sans bouton plutôt qu'avec un lien qui ne mène nulle part.
  const base = g.pointageUrl || g.appUrl;
  const bilan = { ...VIDE };
  let interrompu: string | undefined;

  const messagerie = await ouvrirMessagerie();
  try {
    for (const { inscription: i, serie, derniere } of aPrevenir) {
      const adresse = adresseDeContact(i.user);
      if (!adresse) {
        bilan.ignores += 1;
        continue;
      }
      const c = i.creneau;
      const n = serie.length;
      const res = await messagerie.envoyer(
        adresse,
        `On ne vous voit plus en ${c.activite.nom}`,
        [
          `Bonjour ${nomPourSalutation(i.user.displayName)},`,
          `Vous avez manqué les ${n} dernières séances de ${c.activite.nom} (**${JOUR_LABELS[c.jour].toLowerCase()} ${c.heureDebut}–${c.heureFin}**${c.lieu ? `, ${c.lieu}` : ""}), la dernière ${fmtDateLongue(derniere)}.`,
          `Si c'est un contretemps passager, à bientôt : votre place vous attend. Pensez à prévenir d'une absence depuis l'application ou depuis le rappel de séance, pour que l'animateur ne vous attende pas.`,
          `Si vos disponibilités ont changé, libérez votre place d'un clic : elle profitera à un collègue en liste d'attente, et vous pourrez vous réinscrire plus tard.`,
          base ? `[Je libère ma place](${lienDesinscription(i, base)})` : null,
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
      await prisma.avisAbsences.create({
        data: {
          inscriptionId: i.id,
          userId: i.userId,
          seanceId: serie[0],
          absences: n,
          erreur: res.ok ? null : res.message,
        },
      });
      if (res.ok) {
        bilan.envoyes += 1;
        // Sur la fiche de l'agent : « pourquoi a-t-il reçu ce message ? »
        await audit("AVIS_ABSENCES_ENVOYE", {
          cibleId: i.userId,
          cible: i.user.displayName,
          details: `${c.activite.nom} — ${n} absences consécutives`,
        });
      } else {
        bilan.refuses += 1;
      }
    }
  } finally {
    messagerie.fermer();
  }

  if (interrompu) {
    await audit("AVIS_ABSENCES_INTERROMPUS", { details: interrompu });
  }

  return {
    ...bilan,
    interrompu,
    message: interrompu
      ? `${bilan.envoyes} avis envoyé(s), puis la messagerie a refusé : ${interrompu} — le reste partira demain.`
      : `${bilan.envoyes} avis envoyé(s) après ${seuil} absences consécutives` +
        (bilan.ignores > 0 ? `, ${bilan.ignores} agent(s) sans adresse e-mail` : "") +
        (bilan.refuses > 0 ? `, ${bilan.refuses} adresse(s) refusée(s) par la messagerie` : "") +
        ".",
  };
}

/**
 * Appelé par l'ordonnanceur (src/lib/ordonnanceur.ts). Un passage par jour,
 * aux heures de bureau : ce n'est pas un rappel daté, et un message qui arrive
 * à trois heures du matin se lit comme une machine qui parle. Silencieux : un
 * avis raté ne casse rien, le lendemain reprendra.
 */
export async function declencherAvisAbsencesSiBesoin(): Promise<void> {
  try {
    const g = await getGeneralSettings();
    if (!g.avisAbsencesActif) return;

    const heure = heureEntiereCourante();
    if (heure < 9 || heure >= 18) return;

    const jour = isoDate(aujourdhui());
    if ((await getSetting<string>(CLE_DERNIER_PASSAGE)) === jour) return;

    // Verrou posé AVANT l'envoi : deux battements simultanés n'enverraient
    // qu'une campagne. La ligne par inscrit reste le garde-fou ultime.
    await setSetting(CLE_DERNIER_PASSAGE, jour);
    await envoyerAvisAbsences();
  } catch {
    // le battement suivant réessaiera
  }
}
