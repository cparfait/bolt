"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { PREFIXE_HORS_ANNUAIRE, rattachementsConnus } from "@/lib/comptes";
import { serviceDuReferentiel } from "@/lib/services";
import { audit } from "@/lib/audit";
import { erreur, succes, type ActionState } from "./types";

/**
 * Référentiel des services de la collectivité.
 *
 * Même parti que les lieux (src/lib/actions/lieux.ts) : les comptes portent le
 * libellé en clair et non une clé étrangère, pour que l'historique et les
 * exports gardent le service tel qu'il était. La contrepartie est traitée ici —
 * renommer un service propage le nouveau libellé aux comptes qui le portaient.
 */
export async function enregistrerService(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const id = String(formData.get("id") ?? "");
  const nom = String(formData.get("nom") ?? "").trim().replace(/\s+/g, " ");
  if (nom.length < 2) return erreur("Indiquez le nom du service.");
  if (nom.length > 120) return erreur("Nom trop long.");

  try {
    if (id) {
      const avant = await prisma.service.findUnique({ where: { id } });
      if (!avant) return erreur("Service introuvable.");
      await prisma.service.update({ where: { id }, data: { nom } });
      if (avant.nom !== nom) {
        // Les demandes encore en attente suivent aussi : le libellé qu'elles
        // portent est proposé tel quel au gestionnaire qui les validera, et
        // rattacherait la personne à un service qui n'existe plus.
        const [comptes, demandes] = await Promise.all([
          prisma.user.updateMany({
            where: { service: avant.nom },
            data: { service: nom },
          }),
          prisma.demandeAcces.updateMany({
            where: { service: avant.nom, statut: "EN_ATTENTE" },
            data: { service: nom },
          }),
        ]);
        await audit("SERVICE_RENOMME", {
          userId: user.id,
          cible: `${avant.nom} → ${nom}`,
          details: `${comptes.count} compte(s), ${demandes.count} demande(s) mis à jour`,
        });
      } else {
        await audit("SERVICE_MODIFIE", { userId: user.id, cible: nom });
      }
    } else {
      const ordre = await prisma.service.count();
      await prisma.service.create({ data: { nom, ordre } });
      await audit("SERVICE_CREE", { userId: user.id, cible: nom });
    }
  } catch {
    return erreur("Un service porte déjà ce nom.");
  }

  revalidatePath("/parametres/services");
  revalidatePath("/agents/demandes");
  return succes(`Service « ${nom} » enregistré.`);
}

export async function basculerService(id: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const service = await prisma.service.findUnique({ where: { id } });
  if (!service) return;
  await prisma.service.update({ where: { id }, data: { actif: !service.actif } });
  await audit(service.actif ? "SERVICE_DESACTIVE" : "SERVICE_ACTIVE", {
    userId: user.id,
    cible: service.nom,
  });
  revalidatePath("/parametres/services");
  revalidatePath("/agents/demandes");
}

/**
 * Suppression, refusée dès qu'un compte porte encore ce service : le libellé
 * disparaîtrait de la liste en restant affiché sur les fiches. Un service
 * dissous se désactive — il sort du bon d'inscription sans toucher au passé.
 */
export async function supprimerService(id: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const service = await prisma.service.findUnique({ where: { id } });
  if (!service) return;
  const utilise = await prisma.user.count({ where: { service: service.nom } });
  if (utilise > 0) return;
  await prisma.service.delete({ where: { id } });
  await audit("SERVICE_SUPPRIME", { userId: user.id, cible: service.nom });
  revalidatePath("/parametres/services");
  revalidatePath("/agents/demandes");
}

/**
 * Reprend les services déjà présents dans l'annuaire.
 *
 * L'AD porte le rattachement réel de toute la collectivité dans `department` :
 * retaper cette liste à la main serait absurde, et la recopierait avec des
 * écarts. On importe donc ce qui existe, et le service des sports élague.
 *
 * Ajoute seulement : un service retiré de la liste ne revient pas par un import,
 * et un import répété ne crée pas de doublon.
 */
// Sans paramètre : l'import ne lit rien du formulaire. Le bouton lui en passe
// deux (état précédent, données) comme à toute action de `useActionState` ;
// les ignorer dans la signature vaut mieux que de les nommer pour rien.
export async function importerServicesAnnuaire(): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const { services } = await rattachementsConnus();
  if (services.length === 0) {
    return erreur(
      "L'annuaire ne porte aucun service. Synchronisez-le depuis Paramètres → Annuaire, ou saisissez les services à la main.",
    );
  }

  const existants = await prisma.service.findMany({ select: { nom: true } });
  const connus = new Set(existants.map((s) => s.nom.toLowerCase()));
  const nouveaux = services
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length >= 2 && !connus.has(s.toLowerCase()));

  if (nouveaux.length === 0) {
    return succes("Aucun service à ajouter : l'annuaire n'en porte pas d'autre.");
  }

  const depart = await prisma.service.count();
  await prisma.service.createMany({
    data: nouveaux.map((nom, i) => ({ nom, ordre: depart + i })),
    skipDuplicates: true,
  });
  await audit("SERVICES_IMPORTES", {
    userId: user.id,
    details: `${nouveaux.length} service(s) depuis l'annuaire`,
  });

  revalidatePath("/parametres/services");
  revalidatePath("/agents/demandes");
  return succes(
    `${nouveaux.length} service(s) repris de l'annuaire. Retirez ceux qui n'ont pas à figurer sur le bon d'inscription.`,
  );
}

/**
 * Rattache un libellé orphelin à un service du référentiel.
 *
 * Ne touche QUE les comptes hors annuaire. Le rattachement d'un compte AD vient
 * de l'attribut `department` et la synchronisation le réécrit : le modifier ici
 * donnerait l'illusion d'un ménage fait, défait à la nuit suivante. Ces
 * comptes-là se corrigent dans l'annuaire, et l'écran le dit.
 */
export async function rattacherService(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const ancien = String(formData.get("ancien") ?? "").trim();
  const vers = String(formData.get("vers") ?? "").trim();
  if (!ancien) return erreur("Libellé d'origine manquant.");
  if (!vers) return erreur("Choisissez le service de destination.");

  // La destination est relue dans le référentiel plutôt que reprise du
  // formulaire : c'est son orthographe qui doit être écrite sur les comptes,
  // faute de quoi le rapprochement recréerait un écart en le corrigeant.
  const canonique = await serviceDuReferentiel(vers);
  if (!canonique) return erreur("Ce service ne figure pas dans le référentiel.");

  const [comptes, demandes] = await Promise.all([
    prisma.user.updateMany({
      where: { service: ancien, login: { startsWith: PREFIXE_HORS_ANNUAIRE } },
      data: { service: canonique },
    }),
    prisma.demandeAcces.updateMany({
      where: { service: ancien, statut: "EN_ATTENTE" },
      data: { service: canonique },
    }),
  ]);

  if (comptes.count === 0 && demandes.count === 0) {
    return erreur(
      `Rien à rattacher : « ${ancien} » n'est plus porté que par des comptes de l'annuaire, à corriger dans l'AD.`,
    );
  }

  await audit("SERVICE_RAPPROCHE", {
    userId: user.id,
    cible: `${ancien} → ${canonique}`,
    details: `${comptes.count} compte(s), ${demandes.count} demande(s)`,
  });

  revalidatePath("/parametres/services");
  revalidatePath("/agents");
  revalidatePath("/agents/demandes");
  return succes(
    `${comptes.count} compte(s) rattaché(s) à « ${canonique} ».`,
  );
}
