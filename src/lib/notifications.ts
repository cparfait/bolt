import { prisma } from "./db";
import { envoyerMail } from "./mail";
import { getGeneralSettings } from "./settings";
import { fmtDate, fmtDateLongue, JOUR_LABELS } from "./dates";
import { audit } from "./audit";

/**
 * Notification des inscrits lorsqu'un créneau change de calendrier.
 *
 * Un agent qui s'est inscrit en sachant l'activité fermée pendant les vacances
 * — ou l'inverse — a organisé son emploi du temps en conséquence. Modifier la
 * règle en cours de saison sans le prévenir produit soit des séances désertes,
 * soit des agents devant une porte close.
 *
 * Best-effort : l'envoi ne doit jamais empêcher l'enregistrement du créneau.
 */

export type ChangementCreneau = {
  vacances: {
    ajoutees: string[]; // identifiants de périodes désormais ouvertes
    retirees: string[]; // identifiants de périodes désormais fermées
  };
  // Un déménagement de salle ou un décalage d'horaire se prévient au même
  // titre : l'agent a bloqué un créneau dans son agenda et se déplace.
  lieu?: { avant: string | null; apres: string | null };
  quand?: { avant: string; apres: string };
};

export type ResultatNotification = { destinataires: number; envoyes: number };

/**
 * Prévient les inscrits qu'une séance annulée est finalement maintenue.
 *
 * Symétrique de l'annulation : ils avaient rayé la date de leur agenda, ne rien
 * dire garantirait une salle vide.
 */
export async function notifierSeanceRetablie(
  seanceId: string,
): Promise<ResultatNotification> {
  const seance = await prisma.seance.findUnique({
    where: { id: seanceId },
    include: {
      creneau: {
        include: {
          activite: { select: { nom: true } },
          inscriptions: {
            where: { statut: "VALIDEE" },
            include: { user: { select: { id: true, displayName: true, email: true } } },
          },
        },
      },
      // Symétrique de l'annulation : celui qui était attendu sur cette seule
      // séance a rayé la date, il faut la lui rendre.
      participations: {
        include: { user: { select: { id: true, displayName: true, email: true } } },
      },
    },
  });
  if (!seance) return { destinataires: 0, envoyes: 0 };

  // Un même agent peut être inscrit au créneau et annoncé sur la séance.
  const inscrits = [
    ...new Map(
      [
        ...seance.creneau.inscriptions.map((i) => i.user),
        ...seance.participations.map((p) => p.user),
      ].map((u) => [u.id, u]),
    ).values(),
  ];
  const g = await getGeneralSettings();
  let envoyes = 0;
  for (const u of inscrits) {
    if (!u.email) continue;
    const res = await envoyerMail(
      u.email,
      `Séance maintenue — ${seance.creneau.activite.nom}`,
      [
        `Bonjour ${u.displayName.split(" ")[0]},`,
        `Bonne nouvelle : la séance de ${seance.creneau.activite.nom} du ${fmtDateLongue(seance.date)}, ${seance.creneau.heureDebut}–${seance.creneau.heureFin}${seance.creneau.lieu ? ` (${seance.creneau.lieu})` : ""}, aura finalement bien lieu.`,
        `Elle avait été annulée : vous pouvez la réinscrire à votre agenda.`,
        g.contactEmail
          ? `Le service des sports — ${g.contactEmail}`
          : `Le service des sports`,
      ].join("\n\n"),
    );
    if (res.ok) envoyes += 1;
  }

  await audit("SEANCE_RETABLIE_NOTIFIEE", {
    cible: `${seance.creneau.activite.nom} ${seance.date.toISOString().slice(0, 10)}`,
    details: `${envoyes}/${inscrits.length} inscrits prévenus`,
  });
  return { destinataires: inscrits.length, envoyes };
}

/**
 * Prévient les inscrits qu'une ou plusieurs séances n'auront pas lieu.
 *
 * Un agent inscrit à plusieurs des séances annulées reçoit **un seul** message
 * listant les dates : trois courriels pour une même fermeture de piscine se
 * lisent comme trois incidents, et l'on finit par ne plus les ouvrir.
 *
 * Best-effort, comme le reste des notifications : un serveur SMTP muet ne doit
 * pas empêcher l'annulation d'être enregistrée — le planning fait foi.
 */
export async function notifierSeancesAnnulees(
  seanceIds: string[],
  motif: string,
): Promise<ResultatNotification> {
  if (seanceIds.length === 0) return { destinataires: 0, envoyes: 0 };

  const seances = await prisma.seance.findMany({
    where: { id: { in: seanceIds } },
    include: {
      creneau: {
        include: {
          activite: { select: { nom: true } },
          inscriptions: {
            where: { statut: "VALIDEE" },
            include: { user: { select: { id: true, displayName: true, email: true } } },
          },
        },
      },
      // Attendus à cette seule séance : ils se déplacent au même titre qu'un
      // inscrit, et n'ont même pas le créneau des semaines suivantes pour se
      // rattraper. Les oublier, c'est les envoyer devant une porte close.
      participations: {
        include: { user: { select: { id: true, displayName: true, email: true } } },
      },
    },
    orderBy: { date: "asc" },
  });

  const concernes = new Set<string>();
  const parAgent = new Map<
    string,
    { nom: string; email: string; activites: Set<string>; lignes: string[] }
  >();

  for (const s of seances) {
    const ligne = `• ${s.creneau.activite.nom} — ${fmtDateLongue(s.date)}, ${s.creneau.heureDebut}–${s.creneau.heureFin}${s.creneau.lieu ? ` (${s.creneau.lieu})` : ""}`;
    // Un agent peut être inscrit au créneau *et* annoncé sur la séance : la
    // `Map` par agent et le dédoublonnage des lignes lui garantissent un seul
    // message, sans date répétée.
    const destinataires = [
      ...s.creneau.inscriptions.map((i) => i.user),
      ...s.participations.map((p) => p.user),
    ];
    for (const u of destinataires) {
      concernes.add(u.id);
      if (!u.email) continue;
      const agent = parAgent.get(u.id) ?? {
        nom: u.displayName,
        email: u.email,
        activites: new Set<string>(),
        lignes: [],
      };
      agent.activites.add(s.creneau.activite.nom);
      if (!agent.lignes.includes(ligne)) agent.lignes.push(ligne);
      parAgent.set(u.id, agent);
    }
  }

  const g = await getGeneralSettings();
  let envoyes = 0;
  for (const agent of parAgent.values()) {
    const plusieurs = agent.lignes.length > 1;
    const seuleActivite = agent.activites.size === 1 ? [...agent.activites][0] : null;
    const res = await envoyerMail(
      agent.email,
      `${plusieurs ? "Séances annulées" : "Séance annulée"}${seuleActivite ? ` — ${seuleActivite}` : ""}`,
      [
        `Bonjour ${agent.nom.split(" ")[0]},`,
        plusieurs
          ? `Les séances suivantes n'auront pas lieu :`
          : `La séance suivante n'aura pas lieu :`,
        agent.lignes.join("\n"),
        `Motif : ${motif}`,
        `Votre inscription reste valable et les autres séances sont maintenues : il n'y a rien à faire de votre part.`,
        g.contactEmail
          ? `Le service des sports — ${g.contactEmail}`
          : `Le service des sports`,
      ].join("\n\n"),
    );
    if (res.ok) envoyes += 1;
  }

  await audit("SEANCES_ANNULEES_NOTIFIEES", {
    cible: `${seances.length} séance(s)`,
    details: `${envoyes}/${concernes.size} inscrits prévenus — ${motif}`,
  });

  return { destinataires: concernes.size, envoyes };
}

export async function notifierChangementCreneau(
  creneauId: string,
  changement: ChangementCreneau,
): Promise<ResultatNotification> {
  const { ajoutees, retirees } = changement.vacances;
  const rien =
    ajoutees.length === 0 && retirees.length === 0 && !changement.lieu && !changement.quand;
  if (rien) return { destinataires: 0, envoyes: 0 };

  const creneau = await prisma.creneau.findUnique({
    where: { id: creneauId },
    include: {
      activite: true,
      inscriptions: {
        where: { statut: "VALIDEE" },
        include: { user: { select: { displayName: true, email: true } } },
      },
    },
  });
  if (!creneau) return { destinataires: 0, envoyes: 0 };

  const inscrits = creneau.inscriptions.filter((i) => i.user.email);
  if (inscrits.length === 0) {
    return { destinataires: creneau.inscriptions.length, envoyes: 0 };
  }

  const periodes = await prisma.fermeture.findMany({
    where: { id: { in: [...ajoutees, ...retirees] } },
    orderBy: { debut: "asc" },
  });
  const decrire = (ids: string[]) =>
    periodes
      .filter((p) => ids.includes(p.id))
      .map((p) => `• ${p.libelle} (${fmtDate(p.debut)} → ${fmtDate(p.fin)})`)
      .join("\n");

  const g = await getGeneralSettings();
  const intitule = `${creneau.activite.nom} — ${JOUR_LABELS[creneau.jour].toLowerCase()} ${creneau.heureDebut}`;

  const blocs: string[] = [];
  // L'essentiel d'abord : ce qui change le déplacement de l'agent.
  if (changement.quand) {
    blocs.push(
      `Nouvel horaire : ${changement.quand.apres}\n(auparavant ${changement.quand.avant})`,
    );
  }
  if (changement.lieu) {
    blocs.push(
      `Nouveau lieu : ${changement.lieu.apres ?? "à préciser"}\n(auparavant ${changement.lieu.avant ?? "non précisé"})`,
    );
  }
  if (ajoutees.length > 0) {
    blocs.push(
      `Les séances sont désormais MAINTENUES pendant :\n${decrire(ajoutees)}`,
    );
  }
  if (retirees.length > 0) {
    blocs.push(
      `Il n'y aura finalement PAS de séance pendant :\n${decrire(retirees)}`,
    );
  }

  let envoyes = 0;
  for (const i of inscrits) {
    const res = await envoyerMail(
      i.user.email!,
      `Changement — ${creneau.activite.nom}`,
      [
        `Bonjour ${i.user.displayName.split(" ")[0]},`,
        `Votre créneau de ${intitule} a été modifié.`,
        ...blocs,
        `Votre inscription reste valable : rien à faire de votre part. Consultez le détail dans Bolt à tout moment.`,
        g.contactEmail
          ? `Le service des sports — ${g.contactEmail}`
          : `Le service des sports`,
      ].join("\n\n"),
    );
    if (res.ok) envoyes += 1;
  }

  await audit("CRENEAU_CHANGEMENT_NOTIFIE", {
    cible: intitule,
    details: [
      `${envoyes}/${inscrits.length} inscrits prévenus`,
      changement.quand ? "horaire" : null,
      changement.lieu ? "lieu" : null,
      ajoutees.length > 0 ? `${ajoutees.length} période(s) ouverte(s)` : null,
      retirees.length > 0 ? `${retirees.length} fermée(s)` : null,
    ]
      .filter(Boolean)
      .join(" — "),
  });

  return { destinataires: creneau.inscriptions.length, envoyes };
}
