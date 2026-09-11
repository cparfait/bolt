"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { CoachAcces } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { attribuerLien, lienEmargement, revoquerLien } from "@/lib/coach-access";
import { corpsLienAnimateur, envoyerMail } from "@/lib/mail";
import { getGeneralSettings } from "@/lib/settings";
import { jourUtc } from "@/lib/dates";
import { erreur, succes, type ActionState } from "./types";

const coachSchema = z.object({
  nom: z.string().trim().min(2, "Nom requis."),
  prenom: z.string().trim().min(2, "Prénom requis."),
  email: z.string().trim().email("Adresse e-mail invalide.").or(z.literal("")),
  telephone: z.string().trim().optional(),
  organisme: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

/**
 * Crée ou met à jour un animateur.
 *
 * Tout animateur émarge par lien et code à six chiffres ; celui-ci s'attribue
 * séparément, depuis la liste. Reste le compte réseau, facultatif : renseigné,
 * il rattache le compte de domaine correspondant — créé au besoin, complété à
 * sa première connexion LDAPS — et l'animateur pointe aussi depuis son poste.
 * Vidé, il détache le compte.
 *
 * L'identifiant local a été retiré : il n'apportait rien que le compte de
 * domaine ne fasse déjà pour un agent, ni que le code ne fasse pour un
 * prestataire, et c'était un mot de passe de plus à gérer. On n'en crée plus.
 * Une fiche qui en porte encore un le garde tant que personne ne lui donne de
 * compte réseau : le supprimer d'autorité retirerait à quelqu'un sa façon
 * d'entrer sans que personne l'ait demandé.
 */
export async function enregistrerAnimateur(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("GESTIONNAIRE");
  const id = String(formData.get("id") ?? "");
  const parsed = coachSchema.safeParse({
    nom: formData.get("nom"),
    prenom: formData.get("prenom"),
    email: formData.get("email") ?? "",
    telephone: formData.get("telephone"),
    organisme: formData.get("organisme"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return erreur(parsed.error.issues[0].message);

  const d = parsed.data;
  const login = String(formData.get("login") ?? "").trim().toLowerCase();

  /**
   * Le compte réseau est réservé à la DSI.
   *
   * Rattacher un animateur à un compte de domaine, c'est ouvrir un accès au
   * système d'information — pas un choix du service des sports, qui n'a de
   * toute façon aucun moyen de vérifier qu'un identifiant Windows désigne bien
   * la bonne personne. Un gestionnaire enregistre donc toujours un animateur
   * sans compte, et sur une fiche existante le rattachement en place est
   * conservé tel quel : le champ absent du formulaire ne doit pas pouvoir être
   * réintroduit par une requête forgée.
   */
  const estAdmin = admin.role === "ADMIN";
  const coachExistant = id
    ? await prisma.coach.findUnique({
        where: { id },
        select: { acces: true, userId: true },
      })
    : null;

  // Le mode se déduit de la case : un identifiant saisi rattache, une case
  // vidée détache. Seul survit à cette règle l'identifiant local d'une vieille
  // fiche, tant qu'aucun compte réseau ne vient le remplacer.
  const acces: CoachAcces = !estAdmin
    ? (coachExistant?.acces ?? "LIEN")
    : login
      ? "AD"
      : coachExistant?.acces === "LOCAL"
        ? "LOCAL"
        : "LIEN";

  // Le compte déjà rattaché est repris par défaut : un gestionnaire qui corrige
  // un numéro de téléphone sur une fiche AD ne doit pas la détacher au passage.
  let userId: string | null = coachExistant?.userId ?? null;

  if (estAdmin && acces === "AD") {
    const existant = await prisma.user.findUnique({ where: { login } });
    if (existant?.isLocal) {
      return erreur(
        `« ${login} » est un identifiant local de l'application, pas un compte réseau. Saisissez l'identifiant Windows de l'animateur.`,
      );
    }
    const user =
      existant ??
      (await prisma.user.create({
        data: {
          login,
          displayName: `${d.prenom} ${d.nom}`,
          email: d.email || null,
          role: "COACH",
          isLocal: false,
        },
      }));
    // Le rôle n'est jamais RETIRÉ par ce rattachement. Un agent devient COACH,
    // mais l'administrateur et le gestionnaire gardent le leur : rattacher la
    // responsable du service des sports, qui anime aussi un créneau, la ferait
    // sinon tomber en COACH — et `roleApresConnexion` conserve COACH à la
    // connexion suivante, donc l'appartenance au groupe ne la relèverait pas.
    // Elle perdrait inscriptions, statistiques et paramétrage sans que rien ne
    // le dise. Un rôle se change dans Paramètres → Utilisateurs, pas ici.
    if (user.role !== "ADMIN" && user.role !== "GESTIONNAIRE") {
      await prisma.user.update({ where: { id: user.id }, data: { role: "COACH" } });
    }
    userId = user.id;
  }

  // « Aucun compte » : c'est le geste par lequel on détache un compte devenu
  // sans objet — un animateur qui quitte la collectivité et poursuit comme
  // prestataire. Son lien d'émargement, lui, n'est pas concerné.
  if (acces === "LIEN") userId = null;

  const champs = {
    nom: d.nom,
    prenom: d.prenom,
    email: d.email || null,
    telephone: d.telephone || null,
    organisme: d.organisme || null,
    acces,
    notes: d.notes || null,
    userId,
  };

  if (id) {
    await prisma.coach.update({ where: { id }, data: champs });
    await audit("ANIMATEUR_MODIFIE", {
      userId: admin.id,
      cible: `${d.prenom} ${d.nom}`,
      details: acces,
    });
  } else {
    await prisma.coach.create({ data: champs });
    await audit("ANIMATEUR_CREE", {
      userId: admin.id,
      cible: `${d.prenom} ${d.nom}`,
      details: acces,
    });
  }

  revalidatePath("/animateurs");
  return succes(
    acces === "LIEN"
      ? `${d.prenom} ${d.nom} enregistré. Générez maintenant son lien d'émargement.`
      : `${d.prenom} ${d.nom} enregistré. Son compte réseau lui permet de pointer depuis son poste ; générez aussi son lien s'il émarge depuis son téléphone.`,
  );
}

export async function basculerAnimateur(id: string): Promise<void> {
  const admin = await requireUser("GESTIONNAIRE");
  const coach = await prisma.coach.findUnique({ where: { id } });
  if (!coach) return;
  await prisma.coach.update({ where: { id }, data: { actif: !coach.actif } });
  // Désactiver un animateur coupe immédiatement son accès distant.
  if (coach.actif && coach.userId) {
    await prisma.user.update({ where: { id: coach.userId }, data: { active: false } });
  } else if (!coach.actif && coach.userId) {
    await prisma.user.update({ where: { id: coach.userId }, data: { active: true } });
  }
  await audit(coach.actif ? "ANIMATEUR_DESACTIVE" : "ANIMATEUR_ACTIVE", {
    userId: admin.id,
    cible: `${coach.prenom} ${coach.nom}`,
  });
  revalidatePath("/animateurs");
}

/** État renvoyé par la génération de lien : le lien et le code sont structurés
 *  pour être affichés et copiés, jamais noyés dans un message. */
export type LienState =
  // Union discriminée : chaque variante déclare les champs de l'autre en
  // `undefined`, pour que `state?.error` et `state?.lien` restent lisibles côté
  // composant sans réduction de type préalable.
  | { error: string; lien?: undefined; pin?: undefined; envoi?: undefined; envoiEchoue?: undefined }
  | { error?: undefined; lien: string; pin: string; envoi?: string; envoiEchoue?: boolean }
  | null;

/**
 * Génère (ou renouvelle) le lien d'émargement et le code à 6 chiffres.
 *
 * Le lien ET le code sont toujours restitués à l'écran, que le mail parte ou
 * non : le code est stocké haché, personne ne pourra le relire ensuite, et
 * beaucoup de collectivités transmettent le lien par un canal et le code par un
 * autre. Un envoi qui échoue ne doit surtout pas faire perdre l'accès généré.
 */
export async function genererLienAnimateur(
  _prev: LienState,
  formData: FormData,
): Promise<LienState> {
  const admin = await requireUser("GESTIONNAIRE");
  const id = String(formData.get("id") ?? "");
  const coach = await prisma.coach.findUnique({ where: { id } });
  if (!coach) return { error: "Animateur introuvable." };

  const expirationBrute = String(formData.get("expiration") ?? "").trim();
  const expiration = expirationBrute ? jourUtc(expirationBrute) : null;
  if (expiration && expiration < new Date()) {
    return { error: "La date d'expiration doit être future." };
  }

  const { token, pin } = await attribuerLien(id, expiration);
  const g = await getGeneralSettings();
  // Le pointage peut être publié sous son propre nom (URL de pointage) ; à
  // défaut, les liens portent l'URL publique générale.
  const url = lienEmargement(token, g.pointageUrl || g.appUrl);

  await audit("ANIMATEUR_LIEN_GENERE", {
    userId: admin.id,
    cible: `${coach.prenom} ${coach.nom}`,
    details: expiration ? `expire le ${expirationBrute}` : "sans expiration",
  });
  revalidatePath("/animateurs");

  // L'envoi n'a lieu que si le bouton d'envoi a été utilisé.
  if (formData.get("envoyerMail") === "1" && coach.email) {
    const res = await envoyerMail(
      coach.email,
      "Votre accès à la feuille de présence",
      await corpsLienAnimateur(coach.prenom, url, pin, expiration),
    );
    return {
      lien: url,
      pin,
      envoi: res.ok ? `Message envoyé à ${coach.email}.` : res.message,
      envoiEchoue: !res.ok,
    };
  }

  return { lien: url, pin };
}

export async function revoquerLienAnimateur(id: string): Promise<void> {
  const admin = await requireUser("GESTIONNAIRE");
  const coach = await prisma.coach.findUnique({ where: { id } });
  if (!coach) return;
  await revoquerLien(id);
  await audit("ANIMATEUR_LIEN_REVOQUE", {
    userId: admin.id,
    cible: `${coach.prenom} ${coach.nom}`,
  });
  revalidatePath("/animateurs");
}

export async function supprimerAnimateur(id: string): Promise<void> {
  const admin = await requireUser("GESTIONNAIRE");
  const coach = await prisma.coach.findUnique({
    where: { id },
    include: { _count: { select: { creneaux: true } } },
  });
  // Un animateur rattaché à un créneau garde l'historique : on le désactive.
  if (!coach || coach._count.creneaux > 0) return;
  await prisma.coach.delete({ where: { id } });
  await audit("ANIMATEUR_SUPPRIME", {
    userId: admin.id,
    cible: `${coach.prenom} ${coach.nom}`,
  });
  revalidatePath("/animateurs");
}
