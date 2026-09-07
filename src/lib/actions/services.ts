"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { rattachementsConnus } from "@/lib/comptes";
import {
  analyserCollage,
  appliquerRegroupements,
  cleComparaison,
  normaliser,
  serviceDuReferentiel,
  servicesProposes,
} from "@/lib/services";
import { inventaireLibelles, rapprocher } from "@/lib/rapprochement";
import { REGROUPEMENTS_INITIAUX, SERVICES_OFFICIELS } from "@/lib/referentiel-services";
import { audit } from "@/lib/audit";
import { erreur, succes, type ActionState } from "./types";

/**
 * Référentiel des services et regroupement des libellés.
 *
 * Toute écriture se termine par `appliquerRegroupements` : le service affiché
 * sur un compte est un résultat, pas une saisie. Changer le référentiel ou une
 * règle sans recalculer laisserait l'écran dire une chose et la base une autre
 * — jusqu'à la synchronisation suivante, qui remettrait tout d'aplomb sans
 * qu'on comprenne pourquoi.
 */
async function recalculer(): Promise<number> {
  const touches = await appliquerRegroupements();
  revalidatePath("/parametres/services");
  revalidatePath("/agents");
  revalidatePath("/agents/demandes");
  revalidatePath("/statistiques");
  return touches;
}

export async function enregistrerService(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const id = String(formData.get("id") ?? "");
  const nom = normaliser(String(formData.get("nom") ?? ""));
  if (nom.length < 2) return erreur("Indiquez le nom du service.");
  if (nom.length > 120) return erreur("Nom trop long.");

  try {
    if (id) {
      const avant = await prisma.service.findUnique({ where: { id } });
      if (!avant) return erreur("Service introuvable.");
      await prisma.service.update({ where: { id }, data: { nom } });
      if (avant.nom !== nom) {
        // Les règles pointent sur un NOM : les laisser en arrière ferait
        // disparaître le service qu'elles visent, et les libellés regroupés
        // retomberaient un par un dans l'inventaire.
        const [regles, demandes] = await Promise.all([
          prisma.regroupementService.updateMany({
            where: { cible: avant.nom },
            data: { cible: nom },
          }),
          prisma.demandeAcces.updateMany({
            where: { service: avant.nom, statut: "EN_ATTENTE" },
            data: { service: nom },
          }),
        ]);
        await prisma.user.updateMany({
          where: { service: avant.nom },
          data: { service: nom },
        });
        await audit("SERVICE_RENOMME", {
          userId: user.id,
          cible: `${avant.nom} → ${nom}`,
          details: `${regles.count} règle(s), ${demandes.count} demande(s)`,
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

  await recalculer();
  return succes(`Service « ${nom} » enregistré.`);
}

/**
 * Ajout en masse par collage.
 *
 * Saisir quarante services un par un est le genre de tâche qu'on ne finit pas :
 * la liste existe déjà dans un organigramme, elle doit pouvoir entrer d'un seul
 * geste. Les doublons de graphie sont écartés au passage — « Petite Enfance »
 * collé sous « Petite enfance » ne crée pas une seconde ligne.
 */
export async function collerServices(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const noms = analyserCollage(String(formData.get("texte") ?? ""));
  if (noms.length === 0) return erreur("Rien à ajouter : collez une liste de services.");

  const existants = await prisma.service.findMany({ select: { nom: true } });
  const vues = new Set(existants.map((s) => cleComparaison(s.nom)));
  const nouveaux: string[] = [];
  for (const nom of noms) {
    const cle = cleComparaison(nom);
    if (!cle || nom.length < 2 || nom.length > 120 || vues.has(cle)) continue;
    vues.add(cle);
    nouveaux.push(nom);
  }
  if (nouveaux.length === 0) {
    return erreur("Tous ces services figurent déjà dans la liste.");
  }

  const depart = await prisma.service.count();
  await prisma.service.createMany({
    data: nouveaux.map((nom, i) => ({ nom, ordre: depart + i })),
    skipDuplicates: true,
  });
  await audit("SERVICES_COLLES", {
    userId: user.id,
    details: `${nouveaux.length} service(s)`,
  });

  const touches = await recalculer();
  return succes(
    `${nouveaux.length} service(s) ajouté(s). ${touches} compte(s) rattaché(s) au passage.`,
  );
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
  await recalculer();
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
  await prisma.regroupementService.deleteMany({ where: { cible: service.nom } });
  await prisma.service.delete({ where: { id } });
  await audit("SERVICE_SUPPRIME", { userId: user.id, cible: service.nom });
  await recalculer();
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
// deux, comme à toute action de `useActionState` ; les ignorer dans la
// signature vaut mieux que de les nommer pour rien.
export async function importerServicesAnnuaire(): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const { services } = await rattachementsConnus();
  if (services.length === 0) {
    return erreur(
      "L'annuaire ne porte aucun service. Synchronisez-le depuis Paramètres → Annuaire, ou saisissez les services à la main.",
    );
  }

  const existants = await prisma.service.findMany({ select: { nom: true } });
  const connus = new Set(existants.map((s) => cleComparaison(s.nom)));
  const nouveaux: string[] = [];
  for (const brut of services) {
    const nom = normaliser(brut);
    const cle = cleComparaison(nom);
    if (nom.length < 2 || !cle || connus.has(cle)) continue;
    connus.add(cle);
    nouveaux.push(nom);
  }

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

  await recalculer();
  return succes(
    `${nouveaux.length} service(s) repris de l'annuaire. Retirez ceux qui n'ont pas à figurer sur le bon d'inscription.`,
  );
}

/**
 * Pose une règle : ce libellé désigne ce service.
 *
 * Vaut pour les comptes d'annuaire comme pour les autres. C'est toute la
 * différence avec une correction à la main : la règle porte sur le libellé
 * brut, donc la synchronisation suivante la rejoue au lieu de la défaire.
 */
export async function regrouperLibelle(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const source = normaliser(String(formData.get("source") ?? ""));
  const vers = normaliser(String(formData.get("vers") ?? ""));
  if (!source) return erreur("Libellé d'origine manquant.");
  if (!vers) return erreur("Choisissez le service de destination.");

  // La cible est relue dans le référentiel plutôt que reprise du formulaire :
  // c'est son orthographe qui doit être écrite, faute de quoi le rapprochement
  // recréerait un écart en le corrigeant.
  const cible = await serviceDuReferentiel(vers);
  if (!cible) return erreur("Ce service ne figure pas dans le référentiel.");

  await prisma.regroupementService.upsert({
    where: { source },
    update: { cible },
    create: { source, cible },
  });
  await audit("SERVICE_REGROUPE", {
    userId: user.id,
    cible: `${source} → ${cible}`,
  });

  const touches = await recalculer();
  return succes(
    `« ${source} » rattaché à « ${cible} » — ${touches} compte(s) mis à jour.`,
  );
}

/** Retire une règle : le libellé brut reprend sa place dans l'inventaire. */
export async function retirerRegroupement(source: string): Promise<void> {
  const user = await requireUser("GESTIONNAIRE");
  const regle = await prisma.regroupementService.findUnique({ where: { source } });
  if (!regle) return;
  await prisma.regroupementService.delete({ where: { source } });
  await audit("SERVICE_REGROUPEMENT_RETIRE", {
    userId: user.id,
    cible: `${source} → ${regle.cible}`,
  });
  await recalculer();
}

/**
 * Applique d'un coup les rapprochements que le moteur juge sûrs.
 *
 * Seulement ceux-là : une proposition « probable » demande un regard, et
 * trente agents basculés dans le mauvais service ne se remarquent qu'au bilan
 * de fin de saison. Le reste de la liste reste à trancher à la main, ce qui est
 * précisément le travail que cet écran rend faisable.
 */
export async function appliquerRapprochementsSurs(): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const [libelles, referentiel] = await Promise.all([
    inventaireLibelles(),
    servicesProposes(),
  ]);
  if (referentiel.length === 0) {
    return erreur("Déclarez d'abord des services : il n'y a rien à quoi rattacher.");
  }

  const surs = rapprocher(libelles, referentiel).filter(
    (s) => s.confiance === "sure" && s.proposition,
  );
  if (surs.length === 0) {
    return erreur(
      "Aucun rapprochement sûr à appliquer. Les propositions restantes demandent une décision.",
    );
  }

  for (const s of surs) {
    await prisma.regroupementService.upsert({
      where: { source: s.libelle },
      update: { cible: s.proposition! },
      create: { source: s.libelle, cible: s.proposition! },
    });
  }
  await audit("SERVICES_RAPPROCHES", {
    userId: user.id,
    details: `${surs.length} règle(s) sûre(s)`,
  });

  const touches = await recalculer();
  return succes(
    `${surs.length} libellé(s) rattaché(s), ${touches} compte(s) mis à jour.`,
  );
}

/**
 * Pose le référentiel officiel de la collectivité (src/lib/referentiel-services.ts).
 *
 * Trois gestes, dans cet ordre :
 *  1. chaque service officiel est créé, ou — s'il existe déjà à la graphie
 *     près — aligné sur l'orthographe officielle, avec la même propagation
 *     qu'un renommage : comptes, règles, demandes en attente ;
 *  2. tout autre service du référentiel est RETIRÉ de la liste proposée, pas
 *     supprimé : un import d'annuaire a pu en créer cent, portés par des
 *     fiches, et ce sont eux que le rapprochement va maintenant rattacher ;
 *  3. les regroupements de départ sont posés s'ils n'existent pas encore.
 *
 * Relançable : une seconde exécution ne change rien qu'elle n'ait déjà fait.
 */
export async function chargerReferentielOfficiel(): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const existants = await prisma.service.findMany();
  const parCle = new Map(existants.map((s) => [cleComparaison(s.nom), s]));

  let crees = 0;
  let renommes = 0;
  const officiels = new Set<string>();
  for (const [ordre, nom] of SERVICES_OFFICIELS.entries()) {
    const cle = cleComparaison(nom);
    officiels.add(cle);
    const existant = parCle.get(cle);
    if (!existant) {
      await prisma.service.create({ data: { nom, ordre, actif: true } });
      crees++;
      continue;
    }
    await prisma.service.update({ where: { id: existant.id }, data: { nom, ordre, actif: true } });
    if (existant.nom !== nom) {
      await Promise.all([
        prisma.regroupementService.updateMany({
          where: { cible: existant.nom },
          data: { cible: nom },
        }),
        prisma.demandeAcces.updateMany({
          where: { service: existant.nom, statut: "EN_ATTENTE" },
          data: { service: nom },
        }),
        prisma.user.updateMany({ where: { service: existant.nom }, data: { service: nom } }),
      ]);
      renommes++;
    }
  }

  const retires = await prisma.service.updateMany({
    where: { actif: true, id: { in: existants.filter((s) => !officiels.has(cleComparaison(s.nom))).map((s) => s.id) } },
    data: { actif: false },
  });

  const regles = await prisma.regroupementService.findMany({ select: { source: true } });
  const sources = new Set(regles.map((r) => cleComparaison(r.source)));
  const nouvelles = REGROUPEMENTS_INITIAUX.filter((r) => !sources.has(cleComparaison(r.source)));
  if (nouvelles.length > 0) {
    await prisma.regroupementService.createMany({ data: nouvelles, skipDuplicates: true });
  }

  await audit("REFERENTIEL_OFFICIEL_CHARGE", {
    userId: user.id,
    details: `${crees} créé(s), ${renommes} renommé(s), ${retires.count} retiré(s), ${nouvelles.length} règle(s)`,
  });

  const touches = await recalculer();
  return succes(
    `Référentiel posé : ${crees} service(s) ajouté(s), ${renommes} aligné(s) sur l'orthographe officielle, ` +
      `${retires.count} retiré(s) de la liste proposée, ${nouvelles.length} regroupement(s) posé(s). ` +
      `${touches} compte(s) rattaché(s) au passage.`,
  );
}
