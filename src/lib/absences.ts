import { prisma } from "./db";
import { aujourdhui } from "./dates";
import { adressesDesLieux, itineraireDe } from "./lieux";

/**
 * Lecture des prochaines séances d'un agent — hors des modules d'actions.
 *
 * Volontairement ici et non dans `src/lib/actions/absences.ts` : tout export
 * d'un module « use server » devient un point d'entrée appelable depuis le
 * navigateur, sans session et depuis n'importe quel chemin publié. Cette
 * fonction ne porte aucun contrôle d'accès — ce sont les pages qui l'appellent
 * avec l'identifiant de l'agent connecté. Même règle que `chercherComptes`
 * (src/lib/comptes.ts).
 */

/**
 * Prochaines séances d'un agent, avec l'absence éventuellement déjà annoncée.
 * Sert à la fois au tableau de bord et à la page « Mes activités ».
 *
 * Les séances annulées restent dans la liste, signalées comme telles : les
 * retirer ferait disparaître sans explication un rendez-vous que l'agent avait
 * noté, et le courriel d'annulation peut très bien ne pas avoir été lu.
 */
export async function prochainesSeancesDe(userId: string, limite = 12) {
  const seances = await prisma.seance.findMany({
    where: {
      clotureeAt: null,
      date: { gte: aujourdhui() },
      creneau: { inscriptions: { some: { userId, statut: "VALIDEE" } } },
    },
    include: {
      creneau: { include: { activite: true } },
      absences: { where: { userId }, select: { motif: true } },
    },
    orderBy: [{ date: "asc" }, { creneau: { heureDebut: "asc" } }],
    take: limite,
  });

  const adresses = await adressesDesLieux();
  return seances.map((s) => ({
    id: s.id,
    date: s.date,
    heureDebut: s.creneau.heureDebut,
    heureFin: s.creneau.heureFin,
    lieu: s.creneau.lieu,
    itineraire: itineraireDe(s.creneau.lieu, adresses),
    activite: s.creneau.activite.nom,
    couleur: s.creneau.activite.couleur,
    absent: s.absences.length > 0,
    motif: s.absences[0]?.motif ?? null,
    annulee: s.statut === "ANNULEE",
    motifAnnulation: s.motifAnnulation,
  }));
}
