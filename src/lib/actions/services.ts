"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import {
  analyserCollage,
  appliquerRegroupements,
  cleComparaison,
  normaliser,
  serviceDuReferentiel,
  servicesProposes,
} from "@/lib/services";
import { inventaireLibelles, rapprocher } from "@/lib/rapprochement";
import { lireParametrage, type Parametrage } from "@/lib/parametrage";
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
 * Import d'un fichier de paramétrage (src/lib/parametrage.ts) — le même
 * format que cybermois, dans les deux sens.
 *
 * Le référentiel du fichier est posé dans son ordre : un service absent est
 * créé, un service présent à la graphie près est aligné sur l'orthographe du
 * fichier avec la propagation d'un renommage. Les règles du fichier sont
 * posées, et corrigent une règle existante sur la même source.
 *
 * « Remplacer » décide du sort de ce que le fichier ne mentionne pas : les
 * services sont retirés de la liste proposée — jamais supprimés, des fiches
 * les portent — et les règles retirées. Sans, le fichier complète l'existant.
 */
export async function importerParametrage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const fichier = formData.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) {
    return erreur("Choisissez un fichier de paramétrage (.json).");
  }
  if (fichier.size > 2_000_000) return erreur("Fichier trop volumineux.");
  const remplacer = formData.get("remplacer") === "on";

  let p: Parametrage;
  try {
    p = lireParametrage(await fichier.text());
  } catch (e) {
    return erreur(e instanceof Error ? e.message : "Fichier illisible.");
  }

  const existants = await prisma.service.findMany();
  const parCle = new Map(existants.map((s) => [cleComparaison(s.nom), s]));
  let crees = 0;
  let renommes = 0;
  const mentionnes = new Set<string>();
  for (const [ordre, ligne] of p.referentiel.entries()) {
    const cle = cleComparaison(ligne.nom);
    mentionnes.add(cle);
    const existant = parCle.get(cle);
    if (!existant) {
      await prisma.service.create({ data: { nom: ligne.nom, ordre, actif: ligne.actif } });
      crees++;
      continue;
    }
    await prisma.service.update({
      where: { id: existant.id },
      data: { nom: ligne.nom, ordre, actif: ligne.actif },
    });
    if (existant.nom !== ligne.nom) {
      await Promise.all([
        prisma.regroupementService.updateMany({
          where: { cible: existant.nom },
          data: { cible: ligne.nom },
        }),
        prisma.demandeAcces.updateMany({
          where: { service: existant.nom, statut: "EN_ATTENTE" },
          data: { service: ligne.nom },
        }),
        prisma.user.updateMany({ where: { service: existant.nom }, data: { service: ligne.nom } }),
      ]);
      renommes++;
    }
  }

  let retires = 0;
  if (remplacer) {
    const hors = existants.filter((s) => s.actif && !mentionnes.has(cleComparaison(s.nom)));
    if (hors.length > 0) {
      const r = await prisma.service.updateMany({
        where: { id: { in: hors.map((s) => s.id) } },
        data: { actif: false },
      });
      retires = r.count;
    }
  }

  // Les règles : une source ne peut désigner qu'un service, et la source est
  // la clé — à la graphie près, ce qui oblige à retrouver l'existante avant
  // d'écrire.
  const regles = await prisma.regroupementService.findMany();
  const regleParCle = new Map(regles.map((r) => [cleComparaison(r.source), r]));
  let posees = 0;
  const sourcesFichier = new Set<string>();
  for (const r of p.regroupements) {
    const cle = cleComparaison(r.source);
    sourcesFichier.add(cle);
    const existante = regleParCle.get(cle);
    if (!existante) {
      await prisma.regroupementService.create({ data: r });
      posees++;
    } else if (existante.cible !== r.cible || existante.source !== r.source) {
      await prisma.regroupementService.update({
        where: { source: existante.source },
        data: r,
      });
      posees++;
    }
  }
  let reglesRetirees = 0;
  if (remplacer) {
    const hors = regles.filter((r) => !sourcesFichier.has(cleComparaison(r.source)));
    if (hors.length > 0) {
      const d = await prisma.regroupementService.deleteMany({
        where: { source: { in: hors.map((r) => r.source) } },
      });
      reglesRetirees = d.count;
    }
  }

  await audit("PARAMETRAGE_SERVICES_IMPORTE", {
    userId: user.id,
    cible: fichier.name,
    details: `${crees} créé(s), ${renommes} renommé(s), ${retires} retiré(s) ; ${posees} règle(s) posée(s), ${reglesRetirees} retirée(s)${remplacer ? " (remplacement)" : ""}`,
  });

  const touches = await recalculer();
  return succes(
    `Paramétrage importé : ${crees} service(s) ajouté(s), ${renommes} aligné(s) sur l'orthographe du fichier, ` +
      `${retires} retiré(s) de la liste proposée ; ${posees} regroupement(s) posé(s), ${reglesRetirees} retiré(s). ` +
      `${touches} compte(s) rattaché(s) au passage.`,
  );
}

/**
 * Supprime les libellés retirés que plus personne ne porte.
 *
 * Après le rattachement, les quatre-vingt-dix libellés que l'annuaire avait
 * déposés dans le référentiel se vident un à un : leurs porteurs sont passés
 * sur un vrai service. Ils restent pourtant dans la liste, où ils n'ont plus
 * rien à faire — et les retirer un par un est une tâche qu'on ne finit pas.
 *
 * Ne touche ni aux services actifs, ni à ceux que quelqu'un porte encore : la
 * règle de `supprimerService` vaut ici aussi, en lot.
 */
export async function nettoyerServicesRetires(): Promise<ActionState> {
  const user = await requireUser("GESTIONNAIRE");
  const retires = await prisma.service.findMany({ where: { actif: false } });
  if (retires.length === 0) return erreur("Aucun service retiré.");

  const porteurs = await prisma.user.groupBy({
    by: ["service"],
    where: { service: { in: retires.map((s) => s.nom) } },
    _count: true,
  });
  const portes = new Set(porteurs.map((p) => p.service));
  const vides = retires.filter((s) => !portes.has(s.nom));
  if (vides.length === 0) {
    return erreur(
      "Tous les services retirés sont encore portés par des comptes : rattachez-les d'abord.",
    );
  }

  const noms = vides.map((s) => s.nom);
  await prisma.regroupementService.deleteMany({ where: { cible: { in: noms } } });
  await prisma.service.deleteMany({ where: { id: { in: vides.map((s) => s.id) } } });
  await audit("SERVICES_RETIRES_SUPPRIMES", {
    userId: user.id,
    details: `${vides.length} service(s)`,
  });

  await recalculer();
  const restants = retires.length - vides.length;
  return succes(
    `${vides.length} libellé(s) supprimé(s).` +
      (restants > 0
        ? ` ${restants} reste(nt) : des comptes les portent encore.`
        : ""),
  );
}
