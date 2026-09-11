"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAgent, requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import {
  CHAMP_RGPD,
  champDeclaration,
  declarationsManquantes,
  getTextesLegaux,
  libelleDeclaration,
} from "@/lib/declarations";
import {
  demanderInscription,
  inscrireDirectement,
  placeDisponiblePour,
  prochainRang,
  promouvoirTantQuePossible,
  renumeroterFile,
  verrouCapacite,
} from "@/lib/inscriptions";
import { adresseDeContact } from "@/lib/comptes";
import { nomPourSalutation } from "@/lib/constants";
import { envoyerMail, ouvrirMessagerie } from "@/lib/mail";
import { getGeneralSettings } from "@/lib/settings";
import { assurerCompteAgent } from "@/lib/comptes-annuaire";
import { erreur, succes, type ActionState } from "./types";

/**
 * Les écrans qui montrent la même inscription, rafraîchis ensemble.
 *
 * La grille des créneaux et la fiche de l'agent portent les mêmes boutons.
 * Ne rafraîchir que la grille laissait la fiche afficher un état révolu — et
 * l'inverse serait tout aussi faux : on retire quelqu'un depuis l'écran où on
 * l'a sous les yeux, pas depuis un seul des deux.
 */
function rafraichirInscription(userId: string): void {
  revalidatePath("/inscriptions");
  revalidatePath(`/agents/${userId}`);
}

/** Un agent demande son inscription à un créneau. */
export async function inscrireAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAgent();
  const creneauId = String(formData.get("creneauId") ?? "");
  const commentaire = String(formData.get("commentaire") ?? "");

  // Contrôle des déclarations côté serveur. Le bouton désactivé dans le
  // navigateur est un confort d'usage : c'est ici que se joue la valeur de la
  // preuve, une action serveur restant appelable sans passer par l'écran.
  const textes = await getTextesLegaux();
  const cochees = textes.declarations
    .filter((d) => formData.get(champDeclaration(d.cle)) === "on")
    .map((d) => d.cle);
  const manquantes = declarationsManquantes(textes.declarations, cochees);
  if (manquantes.length > 0) {
    return erreur(
      manquantes.length === textes.declarations.length
        ? "Vous devez accepter les déclarations avant de vous inscrire."
        : `Déclaration${manquantes.length > 1 ? "s" : ""} non acceptée${manquantes.length > 1 ? "s" : ""} : ${manquantes.map((d) => `« ${libelleDeclaration(d)}… »`).join(", ")}.`,
    );
  }
  if (formData.get(CHAMP_RGPD) !== "on") {
    return erreur(
      "Vous devez accepter les mentions d'information sur le traitement de vos données.",
    );
  }

  const res = await demanderInscription(user.id, creneauId, commentaire, {
    version: textes.version,
    rgpdAccepte: true,
  });
  revalidatePath("/mes-activites");
  rafraichirInscription(user.id);
  return res.ok ? succes(res.message) : erreur(res.message);
}

/** Un agent se désiste — la place repart aussitôt à la liste d'attente. */
export async function desisterAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAgent();
  const id = String(formData.get("id") ?? "");
  const inscription = await prisma.inscription.findUnique({
    where: { id },
    include: { creneau: { include: { activite: true } } },
  });
  if (!inscription) return erreur("Inscription introuvable.");
  // Un agent ne peut se désister que de sa propre inscription.
  if (inscription.userId !== user.id && user.role !== "ADMIN" && user.role !== "GESTIONNAIRE") {
    return erreur("Action non autorisée.");
  }
  // Seul un dossier vivant se désiste. Une demande refusée ou déjà désistée
  // passée ici comptait ensuite comme « abandon en cours de saison » au bilan,
  // et une double soumission produisait deux lignes de journal pour un geste.
  if (!["VALIDEE", "EN_ATTENTE", "LISTE_ATTENTE"].includes(inscription.statut)) {
    return erreur("Cette inscription n'est plus active.");
  }

  await prisma.inscription.update({
    where: { id },
    data: {
      statut: "DESISTEE",
      rang: null,
      decisionAt: new Date(),
      decidePar: user.displayName,
      motif: String(formData.get("motif") ?? "") || null,
    },
  });
  await renumeroterFile(inscription.creneauId);
  // « Tant que possible » et non une seule promotion : en capacité mutualisée,
  // le premier de la file peut déjà détenir une place et ne rien consommer —
  // la place rendue doit alors profiter au suivant (voir `promouvoirTantQuePossible`).
  const promu = await promouvoirTantQuePossible(inscription.creneauId);

  await audit("INSCRIPTION_DESISTEE", {
    userId: user.id,
    cibleId: inscription.userId,
    cible: inscription.creneau.activite.nom,
  });

  revalidatePath("/mes-activites");
  rafraichirInscription(inscription.userId);
  return succes(`Désinscription enregistrée.${promu}`);
}

/** Le service des sports arbitre une demande. */
export async function deciderInscription(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("GESTIONNAIRE");
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const motif = String(formData.get("motif") ?? "").trim();

  const inscription = await prisma.inscription.findUnique({
    where: { id },
    include: { user: true, creneau: { include: { activite: true } } },
  });
  if (!inscription) return erreur("Demande introuvable.");

  if (decision === "valider") {
    // Vérification et écriture sous le même verrou que les demandes des
    // agents et les promotions automatiques : c'est ce qui empêche deux
    // validations concurrentes de la dernière place.
    const complet = await verrouCapacite(inscription.creneauId, async () => {
      if (!(await placeDisponiblePour(inscription.creneauId, inscription.userId))) return true;
      await prisma.inscription.update({
        where: { id },
        data: {
          statut: "VALIDEE",
          rang: null,
          decisionAt: new Date(),
          decidePar: admin.displayName,
          motif: null,
        },
      });
      return false;
    });
    if (complet) {
      return erreur(
        "Le créneau est complet. Augmentez la capacité ou placez l'agent en liste d'attente.",
      );
    }
    // Validé depuis la file : les suivants remontent d'un cran.
    if (inscription.statut === "LISTE_ATTENTE") await renumeroterFile(inscription.creneauId);
    await audit("INSCRIPTION_VALIDEE", {
      userId: admin.id,
      cibleId: inscription.userId,
      cible: `${inscription.user.displayName} → ${inscription.creneau.activite.nom}`,
    });
    const adresse = adresseDeContact(inscription.user);
    if (adresse) {
      await envoyerMail(
        adresse,
        `Inscription confirmée — ${inscription.creneau.activite.nom}`,
        [
          `Bonjour ${nomPourSalutation(inscription.user.displayName)},`,
          `Votre inscription à ${inscription.creneau.activite.nom} est confirmée : **${inscription.creneau.jour.toLowerCase()} de ${inscription.creneau.heureDebut} à ${inscription.creneau.heureFin}**${inscription.creneau.lieu ? ` — **${inscription.creneau.lieu}**` : ""}.`,
          `Bonne pratique !`,
        ].join("\n\n"),
      );
    }
    rafraichirInscription(inscription.userId);
    return succes(`${inscription.user.displayName} est inscrit.`);
  }

  if (decision === "attente") {
    await prisma.inscription.update({
      where: { id },
      data: {
        statut: "LISTE_ATTENTE",
        rang: await prochainRang(inscription.creneauId),
        decisionAt: new Date(),
        decidePar: admin.displayName,
      },
    });
    await audit("INSCRIPTION_EN_ATTENTE", {
      userId: admin.id,
      cibleId: inscription.userId,
      cible: `${inscription.user.displayName} → ${inscription.creneau.activite.nom}`,
    });
    // Rétrograder un inscrit libère sa place : la file avance, comme sur un
    // désistement. Sans cela elle restait figée jusqu'au prochain départ.
    // Sauf lui : file vide, il repassait validé dans la seconde.
    const promu = await promouvoirTantQuePossible(inscription.creneauId, id);
    // L'agent l'apprenait en ne recevant pas le rappel de la veille. Le refus
    // et la validation écrivent ; la rétrogradation doit écrire aussi.
    if (inscription.statut === "VALIDEE") {
      const adresse = adresseDeContact(inscription.user);
      if (adresse) {
        await envoyerMail(
          adresse,
          `Votre place en ${inscription.creneau.activite.nom}`,
          [
            `Bonjour ${nomPourSalutation(inscription.user.displayName)},`,
            `Le service des sports a dû replacer votre inscription à ${inscription.creneau.activite.nom} (**${inscription.creneau.jour.toLowerCase()} ${inscription.creneau.heureDebut}**) en liste d'attente. Vous serez prévenu dès qu'une place se libère.`,
            `Pour toute question, contactez le service des sports.`,
          ].join("\n\n"),
        );
      }
    }
    rafraichirInscription(inscription.userId);
    return succes(`${inscription.user.displayName} placé en liste d'attente.${promu}`);
  }

  if (decision === "refuser") {
    await prisma.inscription.update({
      where: { id },
      data: {
        statut: "REFUSEE",
        rang: null,
        decisionAt: new Date(),
        decidePar: admin.displayName,
        motif: motif || null,
      },
    });
    await renumeroterFile(inscription.creneauId);
    await audit("INSCRIPTION_REFUSEE", {
      userId: admin.id,
      cibleId: inscription.userId,
      cible: `${inscription.user.displayName} → ${inscription.creneau.activite.nom}`,
      details: motif,
    });
    // Refuser une inscription déjà validée rend sa place au groupe.
    const promu = await promouvoirTantQuePossible(inscription.creneauId);
    const adresse = adresseDeContact(inscription.user);
    if (adresse) {
      await envoyerMail(
        adresse,
        `Votre demande — ${inscription.creneau.activite.nom}`,
        [
          `Bonjour ${nomPourSalutation(inscription.user.displayName)},`,
          `Votre demande d'inscription à ${inscription.creneau.activite.nom} n'a pas pu être retenue${motif ? ` : ${motif}` : "."}`,
          `D'autres créneaux restent ouverts : consultez le catalogue de l'application.`,
        ].join("\n\n"),
      );
    }
    rafraichirInscription(inscription.userId);
    return succes(`Demande refusée.${promu}`);
  }

  return erreur("Décision inconnue.");
}

/** Inscription directe par le service des sports (agent sans accès, dossier papier). */
export async function inscrireAgentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("GESTIONNAIRE");
  const creneauId = String(formData.get("creneauId") ?? "");
  const login = String(formData.get("login") ?? "").trim();
  if (!creneauId || !login) return erreur("Sélectionnez un agent et un créneau.");

  // L'agent vient peut-être de l'annuaire sans jamais s'être connecté : son
  // compte applicatif est créé à cet instant, avec son rattachement.
  const userId = await assurerCompteAgent(login);
  if (!userId) return erreur("Agent introuvable dans l'annuaire.");

  const agent = await prisma.user.findUnique({ where: { id: userId } });
  const creneau = await prisma.creneau.findUnique({
    where: { id: creneauId },
    include: { activite: true },
  });
  if (!agent || !creneau) return erreur("Agent ou créneau introuvable.");

  // Le même moteur que le guichet et la feuille d'émargement : contrôle de la
  // place et écriture sous le verrou de capacité. Cette action comptait la
  // place puis écrivait hors verrou — la seule porte par laquelle deux
  // validations simultanées de la dernière place passaient encore. L'accusé
  // de réception part de là aussi : l'agent n'a rien demandé, et sans ce
  // message il découvrirait son inscription en recevant le rappel de la veille.
  const res = await inscrireDirectement(creneauId, userId, admin.displayName);
  if (res.deja) {
    return erreur(`${agent.displayName} est déjà positionné sur ce créneau.`);
  }

  await audit("INSCRIPTION_MANUELLE", {
    userId: admin.id,
    cibleId: userId,
    cible: `${agent.displayName} → ${creneau.activite.nom}`,
  });

  rafraichirInscription(userId);
  return succes(
    res.statut === "LISTE_ATTENTE"
      ? `${agent.displayName} placé en liste d'attente (créneau complet).`
      : `${agent.displayName} inscrit à ${creneau.activite.nom}.`,
  );
}

/** Jamais plus de destinataires par relance : une liste de décrocheurs n'en a pas autant. */
const MAX_RELANCE = 200;

/**
 * Relance groupée des agents qui ne viennent plus.
 *
 * Le formulaire désigne des AGENTS (`userId`), et l'adresse est relue en base
 * (`adresseDeContact`) : une action serveur s'appelle sans passer par
 * l'écran, et recevoir les adresses en clair en faisait un service d'envoi de
 * courriels, au nom de la collectivité, vers n'importe qui. Le champ `email`
 * reste accepté le temps que le formulaire change, mais seulement si
 * l'adresse est celle d'un compte actif — sinon elle est ignorée.
 *
 * Cadencé (`ouvrirMessagerie`) : une relance de rentrée compte des dizaines
 * de destinataires, et Microsoft 365 plafonne les soumissions par minute.
 */
export async function relancerDecrocheurs(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("GESTIONNAIRE");
  const userIds = [...new Set(formData.getAll("userId").map(String).filter(Boolean))];
  const emails = [
    ...new Set(formData.getAll("email").map((e) => String(e).trim().toLowerCase()).filter(Boolean)),
  ];
  if (userIds.length === 0 && emails.length === 0) {
    return erreur("Aucun destinataire sélectionné.");
  }
  if (userIds.length + emails.length > MAX_RELANCE) {
    return erreur(`Pas plus de ${MAX_RELANCE} destinataires par relance.`);
  }

  const comptes = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        ...(userIds.length > 0 ? [{ id: { in: userIds } }] : []),
        ...emails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })),
        ...emails.map((email) => ({ emailContact: { equals: email, mode: "insensitive" as const } })),
      ],
    },
    select: { id: true, displayName: true, email: true, emailContact: true },
  });
  const destinataires = comptes
    .map((u) => ({ nom: u.displayName, adresse: adresseDeContact(u) }))
    .filter((d): d is { nom: string; adresse: string } => d.adresse !== null);
  if (destinataires.length === 0) return erreur("Aucun destinataire joignable.");

  const g = await getGeneralSettings();
  const message = String(formData.get("message") ?? "").trim();
  let envoyes = 0;
  const echecs: string[] = [];

  const messagerie = await ouvrirMessagerie();
  try {
    for (const d of destinataires) {
      const res = await messagerie.envoyer(
        d.adresse,
        "Vos activités sportives — on ne vous voit plus",
        message ||
          [
            `Bonjour,`,
            `Nous avons remarqué que vous n'avez pas participé à vos dernières séances. Si vos disponibilités ont changé, vous pouvez vous désinscrire depuis l'application : cela libérera votre place pour un collègue en liste d'attente.`,
            `Et si c'est un simple contretemps, nous serons ravis de vous revoir à la prochaine séance !`,
            g.contactEmail ? `Le service des sports — ${g.contactEmail}` : `Le service des sports`,
          ].join("\n\n"),
      );
      if (res.ok) envoyes += 1;
      else echecs.push(d.nom);
    }
  } finally {
    messagerie.fermer();
  }

  await audit("RELANCE_DECROCHEURS", {
    userId: admin.id,
    details: `${envoyes}/${destinataires.length} envoyés`,
  });

  if (envoyes === 0) {
    return erreur(`Aucun message envoyé. Vérifiez la configuration de la messagerie.`);
  }
  return succes(
    echecs.length > 0
      ? `${envoyes} message(s) envoyé(s). Échecs : ${echecs.join(", ")}.`
      : `${envoyes} message(s) envoyé(s).`,
  );
}
