"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { clientIp, estInterne } from "@/lib/net";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { alerterSecurite } from "@/lib/alertes";
import {
  deposerDemande,
  refuserDemande,
  refuserEnAttente,
  supprimerRefusees,
  validerDemande,
} from "@/lib/demandes";
import { requireUser } from "@/lib/session";
import { codeDemandeValide, getGeneralSettings } from "@/lib/settings";
import { erreur, succes, type ActionState } from "./types";

/**
 * Dépôt d'une demande d'accès depuis Internet.
 *
 * Trois compteurs, pour trois abus distincts — même raisonnement que
 * `demanderLienAction`, dont il faut relire le commentaire :
 *
 *  • par IP, pour qu'une machine ne remplisse pas la file toute seule ;
 *  • global, sans clé d'identité, parce qu'une source distribuée fait varier
 *    l'IP et ne remplit jamais le compteur précédent ;
 *  • un champ leurre, invisible d'un humain, que les robots de formulaire
 *    remplissent — le plus efficace des trois pour ce qu'il coûte.
 *
 * Le plafond global ne vaut que pour l'extérieur : pendant une attaque, une
 * personne accompagnée par le service des sports depuis un poste du réseau doit
 * continuer à pouvoir déposer sa demande.
 */

const PLAFOND_HORAIRE = 40;

/**
 * Dépôts autorisés par heure et par adresse IP.
 *
 * Deux valeurs, parce que la même IP ne dit pas la même chose des deux côtés.
 * Depuis Internet, une machine qui dépose quatre demandes en une heure n'a
 * aucune raison légitime de le faire. Depuis le réseau, c'est le cas normal
 * d'un poste partagé — l'accueil, le gardiennage, ou le service des sports qui
 * accompagne des vacataires à la rentrée. Ils sortent tous sous la même
 * adresse, et le compteur les prendrait pour un robot.
 *
 * On ne supprime pas la limite à l'intérieur pour autant : un poste compromis
 * reste un poste. On la desserre au niveau de ce qu'une file d'attente peut
 * absorber sans devenir illisible.
 */
const PAR_IP_EXTERNE = 3;
const PAR_IP_INTERNE = 20;

// Le message est le même quoi qu'il arrive : adresse inconnue, adresse déjà
// titulaire d'un compte, demande déjà déposée. Ce formulaire est publié sur
// Internet ; en dire plus permettrait de vérifier qui travaille dans la
// collectivité, ce que `envoyerLienConnexion` se garde déjà de faire.
const ACCUSE =
  "Votre demande a bien été transmise au service des sports. Vous recevrez un message dès qu'elle aura été examinée.";

export async function deposerDemandeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const g = await getGeneralSettings();
  if (!g.demandeAccesActive) {
    return erreur("Les demandes d'accès en ligne ne sont pas activées.");
  }

  // Même contrôle que la page, et pas seulement là : une action serveur est
  // adressée par un identifiant global, donc appelable depuis n'importe quel
  // chemin publié — la vérification faite à l'affichage ne la couvre pas.
  if (!codeDemandeValide(g, String(formData.get("i") ?? ""))) {
    return erreur("Ce formulaire n'est plus disponible à cette adresse.");
  }

  // Champ leurre : un humain ne le voit pas, un robot le remplit. On répond
  // comme si tout allait bien — signaler le rejet apprendrait au robot à
  // contourner.
  if (String(formData.get("organisme_") ?? "").trim() !== "") {
    await audit("DEMANDE_ACCES_LEURRE");
    return succes(ACCUSE);
  }

  const nom = String(formData.get("nom") ?? "").trim().replace(/\s+/g, " ");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const service = String(formData.get("service") ?? "").trim().slice(0, 120);
  const message = String(formData.get("message") ?? "").trim().slice(0, 500);

  if (nom.length < 2) return erreur("Indiquez votre nom et votre prénom.");
  if (nom.length > 120) return erreur("Nom trop long.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return erreur("Adresse e-mail invalide.");
  }

  const ip = clientIp(await headers());

  const interne = estInterne(ip);

  if (!interne && !rateLimit("demande-acces:global", PLAFOND_HORAIRE, 3600).ok) {
    await audit("DEMANDE_ACCES_PLAFOND", { cible: email });
    await alerterSecurite(
      "demande-acces",
      "le plafond des demandes d'accès a été atteint",
      `Plus de ${PLAFOND_HORAIRE} demandes d'accès ont été déposées depuis Internet en une heure. Les suivantes sont refusées jusqu'à la fin de l'heure en cours.\n\nUn dépôt automatisé est plus probable qu'une rentrée chargée : l'écran « Demandes d'accès » affiche l'adresse IP de chaque dépôt, une même adresse répétée trahit un robot.`,
    );
    return erreur("Trop de demandes en cours. Réessayez dans quelques minutes.");
  }
  const parIp = interne ? PAR_IP_INTERNE : PAR_IP_EXTERNE;
  if (!rateLimit(`demande-acces-ip:${ip}`, parIp, 3600).ok) {
    return erreur("Trop de demandes depuis cet accès. Réessayez plus tard.");
  }

  await deposerDemande({ nom, email, service, message, ip });
  return succes(ACCUSE);
}

export async function validerDemandeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("GESTIONNAIRE");
  const res = await validerDemande(String(formData.get("id") ?? ""), admin);
  revalidatePath("/agents/demandes");
  revalidatePath("/agents");
  revalidatePath("/", "layout");
  return res.ok ? succes(res.message) : erreur(res.message);
}

export async function refuserDemandeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("GESTIONNAIRE");
  const res = await refuserDemande(
    String(formData.get("id") ?? ""),
    String(formData.get("motif") ?? ""),
    admin,
  );
  revalidatePath("/agents/demandes");
  revalidatePath("/", "layout");
  return res.ok ? succes(res.message) : erreur(res.message);
}

export async function refuserEnAttenteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("GESTIONNAIRE");
  const n = await refuserEnAttente(String(formData.get("motif") ?? ""), admin);
  revalidatePath("/agents/demandes");
  revalidatePath("/", "layout");
  return n === 0
    ? erreur("Aucune demande en attente.")
    : succes(`${n} demande(s) refusée(s). Rien n'a été envoyé aux adresses concernées.`);
}

export async function supprimerRefuseesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireUser("ADMIN");
  // Suppression définitive : on exige que le formulaire l'ait explicitement
  // demandé, pour qu'une soumission égarée ne l'emporte pas au passage.
  if (String(formData.get("confirmation") ?? "") !== "supprimer") {
    return erreur("Confirmation manquante.");
  }
  const n = await supprimerRefusees(admin);
  revalidatePath("/agents/demandes");
  return n === 0
    ? erreur("Aucune demande refusée à supprimer.")
    : succes(`${n} demande(s) supprimée(s) définitivement.`);
}
