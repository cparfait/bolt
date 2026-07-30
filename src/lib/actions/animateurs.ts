"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
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
  acces: z.enum(["AD", "LOCAL", "LIEN"]),
  notes: z.string().trim().optional(),
});

/**
 * Crée ou met à jour un animateur.
 *
 * Selon le mode d'accès :
 *  • AD    — on rattache le compte de domaine correspondant (créé au besoin,
 *            il sera complété à sa première connexion LDAPS) ;
 *  • LOCAL — on crée/actualise un compte local avec mot de passe ;
 *  • LIEN  — aucun compte : le lien et le code sont attribués séparément.
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
    acces: formData.get("acces"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return erreur(parsed.error.issues[0].message);

  const d = parsed.data;
  const login = String(formData.get("login") ?? "").trim().toLowerCase();
  const motDePasse = String(formData.get("motDePasse") ?? "");

  let userId: string | null = null;

  if (d.acces === "AD") {
    if (!login) return erreur("Renseignez l'identifiant Windows de l'animateur.");
    const existant = await prisma.user.findUnique({ where: { login } });
    if (existant?.isLocal) {
      return erreur(
        `L'identifiant « ${login} » correspond à un compte local. Choisissez le mode « Identifiant local » ou un autre identifiant.`,
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
    if (user.role !== "ADMIN") {
      await prisma.user.update({ where: { id: user.id }, data: { role: "COACH" } });
    }
    userId = user.id;
  }

  if (d.acces === "LOCAL") {
    if (!login) return erreur("Renseignez un identifiant local.");
    const existant = await prisma.user.findUnique({ where: { login } });
    if (existant && !existant.isLocal) {
      return erreur(
        `L'identifiant « ${login} » existe déjà comme compte Active Directory.`,
      );
    }
    if (!existant && motDePasse.length < 8) {
      return erreur("Le mot de passe doit comporter au moins 8 caractères.");
    }
    if (motDePasse && motDePasse.length < 8) {
      return erreur("Le mot de passe doit comporter au moins 8 caractères.");
    }
    const data = {
      displayName: `${d.prenom} ${d.nom}`,
      email: d.email || null,
      role: "COACH" as const,
      isLocal: true,
      active: true,
      ...(motDePasse ? { passwordHash: await bcrypt.hash(motDePasse, 12) } : {}),
    };
    const user = existant
      ? await prisma.user.update({ where: { id: existant.id }, data })
      : await prisma.user.create({ data: { login, ...data } });
    userId = user.id;
  }

  const champs = {
    nom: d.nom,
    prenom: d.prenom,
    email: d.email || null,
    telephone: d.telephone || null,
    organisme: d.organisme || null,
    acces: d.acces,
    notes: d.notes || null,
    userId,
  };

  if (id) {
    await prisma.coach.update({ where: { id }, data: champs });
    await audit("ANIMATEUR_MODIFIE", {
      userId: admin.id,
      cible: `${d.prenom} ${d.nom}`,
      details: d.acces,
    });
  } else {
    await prisma.coach.create({ data: champs });
    await audit("ANIMATEUR_CREE", {
      userId: admin.id,
      cible: `${d.prenom} ${d.nom}`,
      details: d.acces,
    });
  }

  revalidatePath("/animateurs");
  return succes(
    d.acces === "LIEN"
      ? `${d.prenom} ${d.nom} enregistré. Générez maintenant son lien d'émargement.`
      : `${d.prenom} ${d.nom} enregistré.`,
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
