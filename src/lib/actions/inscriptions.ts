"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAgent, requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { accuserReception } from "@/lib/inscriptions";
import {
  CHAMP_RGPD,
  champDeclaration,
  declarationsManquantes,
  getTextesLegaux,
  libelleDeclaration,
} from "@/lib/declarations";
import {
  demanderInscription,
  placeDisponiblePour,
  prochainRang,
  promouvoirEtPrevenir,
  renumeroterFile,
} from "@/lib/inscriptions";
import { adresseDeContact } from "@/lib/comptes";
import { nomPourSalutation } from "@/lib/constants";
import { envoyerMail } from "@/lib/mail";
import { getGeneralSettings } from "@/lib/settings";
import { assurerCompteAgent } from "./agents";
import { erreur, succes, type ActionState } from "./types";

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
  revalidatePath("/inscriptions");
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
  const promu = await promouvoirEtPrevenir(inscription.creneauId);

  await audit("INSCRIPTION_DESISTEE", {
    userId: user.id,
    cible: inscription.creneau.activite.nom,
  });

  revalidatePath("/mes-activites");
  revalidatePath("/inscriptions");
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
    if (!(await placeDisponiblePour(inscription.creneauId, inscription.userId))) {
      return erreur(
        "Le créneau est complet. Augmentez la capacité ou placez l'agent en liste d'attente.",
      );
    }
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
    await audit("INSCRIPTION_VALIDEE", {
      userId: admin.id,
      cible: `${inscription.user.displayName} → ${inscription.creneau.activite.nom}`,
    });
    const adresse = adresseDeContact(inscription.user);
    if (adresse) {
      await envoyerMail(
        adresse,
        `Inscription confirmée — ${inscription.creneau.activite.nom}`,
        [
          `Bonjour ${nomPourSalutation(inscription.user.displayName)},`,
          `Votre inscription à ${inscription.creneau.activite.nom} est confirmée : ${inscription.creneau.jour.toLowerCase()} de ${inscription.creneau.heureDebut} à ${inscription.creneau.heureFin}${inscription.creneau.lieu ? ` — ${inscription.creneau.lieu}` : ""}.`,
          `Bonne pratique !`,
        ].join("\n\n"),
      );
    }
    revalidatePath("/inscriptions");
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
      cible: inscription.user.displayName,
    });
    // Rétrograder un inscrit libère sa place : la file avance, comme sur un
    // désistement. Sans cela elle restait figée jusqu'au prochain départ.
    const promu = await promouvoirEtPrevenir(inscription.creneauId);
    revalidatePath("/inscriptions");
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
      cible: inscription.user.displayName,
      details: motif,
    });
    // Refuser une inscription déjà validée rend sa place au groupe.
    const promu = await promouvoirEtPrevenir(inscription.creneauId);
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
    revalidatePath("/inscriptions");
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

  const complet = !(await placeDisponiblePour(creneauId, userId));
  const existante = await prisma.inscription.findUnique({
    where: { creneauId_userId: { creneauId, userId } },
  });
  if (existante && ["VALIDEE", "LISTE_ATTENTE"].includes(existante.statut)) {
    return erreur(`${agent.displayName} est déjà positionné sur ce créneau.`);
  }

  const data = {
    statut: complet ? ("LISTE_ATTENTE" as const) : ("VALIDEE" as const),
    rang: complet ? await prochainRang(creneauId) : null,
    decisionAt: new Date(),
    decidePar: admin.displayName,
    motif: null,
  };

  if (existante) {
    await prisma.inscription.update({ where: { id: existante.id }, data });
  } else {
    await prisma.inscription.create({ data: { creneauId, userId, ...data } });
  }

  await audit("INSCRIPTION_MANUELLE", {
    userId: admin.id,
    cible: `${agent.displayName} → ${creneau.activite.nom}`,
  });

  // L'agent n'a rien demandé : sans ce message, il découvrirait son inscription
  // en recevant le rappel de la veille — ou sur place. Il part à l'adresse que
  // le service des sports a saisie pour lui quand elle existe.
  await accuserReception(userId, creneauId, data.statut, data.rang, "service");

  revalidatePath("/inscriptions");
  return succes(
    complet
      ? `${agent.displayName} placé en liste d'attente (créneau complet).`
      : `${agent.displayName} inscrit à ${creneau.activite.nom}.`,
  );
}

/** Relance groupée des agents qui ne viennent plus. */
export async function relancerDecrocheurs(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("GESTIONNAIRE");
  const emails = formData.getAll("email").map(String).filter(Boolean);
  if (emails.length === 0) return erreur("Aucun destinataire sélectionné.");

  const g = await getGeneralSettings();
  const message = String(formData.get("message") ?? "").trim();
  let envoyes = 0;
  const echecs: string[] = [];

  for (const email of emails) {
    const res = await envoyerMail(
      email,
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
    else echecs.push(email);
  }

  await audit("RELANCE_DECROCHEURS", {
    userId: admin.id,
    details: `${envoyes}/${emails.length} envoyés`,
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
