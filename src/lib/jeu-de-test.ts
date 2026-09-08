import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import type { EtatPresence, Jour } from "@prisma/client";
import { prisma } from "./db";
import { ajouterJours, aujourdhui, fmtMois } from "./dates";
import { compterAReinitialiser } from "./reinitialisation";
import { genererSeancesSaison } from "./seances";
import { participeALaSeance, placeDisponiblePour, prochainRang } from "./inscriptions";
import { PREFIXE_HORS_ANNUAIRE } from "./comptes";

/**
 * Jeu de test — une collectivité fictive, mais complète.
 *
 * Une application de gestion ne se juge pas à vide. Les écrans qui comptent —
 * tableau de bord, statistiques, feuilles à rattraper, liste d'attente,
 * décrocheurs — n'existent qu'à partir du moment où il y a de la matière, et
 * les demander à un service des sports qui découvre l'outil revient à lui
 * demander de saisir une saison entière avant de pouvoir se faire un avis.
 *
 * D'où ce jeu : une saison calée sur la date du jour, des activités, des
 * agents, un historique de fréquentation vraisemblable — assez pour que chaque
 * écran ait quelque chose à montrer, y compris ceux qui signalent un problème
 * (feuilles non transmises, séance annulée, demandes en attente).
 *
 * ── Ce qu'il crée, et pas plus ────────────────────────────────────────────
 *
 * Exactement ce que la remise à zéro efface (voir src/lib/reinitialisation.ts).
 * L'invariant est volontaire et vaut mieux que la souplesse : charger le jeu
 * puis remettre à zéro doit rendre la base telle qu'on l'avait trouvée. C'est
 * pourquoi ni les paramètres, ni le référentiel des services, ni les
 * déclarations, ni le miroir de l'annuaire ne sont touchés ici — ils
 * survivraient à la remise à zéro et laisseraient du faux derrière eux.
 *
 * Pour la même raison, aucun compte ADMIN ni GESTIONNAIRE : ceux-là sont
 * conservés par la remise à zéro. Le seed en ligne de commande en crée deux,
 * mais lui installe une base neuve, ce qui n'est pas le même geste.
 *
 * Déterministe : le tirage part d'une graine fixe, deux chargements de suite
 * produisent la même collectivité. Un défaut d'affichage constaté sur ce jeu se
 * reproduit donc chez qui le recharge.
 */

// ── Ce que la collectivité fictive propose ──────────────────────────────────

const ACTIVITES: {
  nom: string;
  description: string;
  couleur: string;
  icone: string;
  ordre: number;
  suiviPresence?: boolean;
  capacitePartagee?: boolean;
  capacite?: number;
}[] = [
  {
    nom: "Yoga",
    description: "Séance douce, tapis fournis, tous niveaux.",
    couleur: "#7c3aed",
    icone: "Flower2",
    ordre: 0,
  },
  {
    nom: "Musculation",
    description: "Salle équipée, accompagnement personnalisé. Serviette à prendre.",
    couleur: "#4f46e5",
    icone: "Dumbbell",
    ordre: 1,
    // Un seul groupe de 10 agents, deux séances par semaine : la place suit
    // l'agent d'un créneau à l'autre et ne se compte qu'une fois côté salle.
    // Côté agent, en revanche, chaque créneau consomme une inscription — la
    // capacité mutualisée dit ce que l'activité offre, pas ce qu'un agent a le
    // droit de prendre (voir `maxInscriptionsParAgent`).
    capacitePartagee: true,
    capacite: 10,
  },
  {
    nom: "Renforcement musculaire",
    description: "Circuit training au poids du corps.",
    couleur: "#059669",
    icone: "Zap",
    ordre: 2,
  },
  {
    nom: "Aquagym",
    description:
      "Bassin réservé aux agents. Maillot de bain, bonnet de bain, serviette, claquettes et gel douche à prendre.",
    couleur: "#0891b2",
    icone: "Waves",
    ordre: 3,
  },
];

const CRENEAUX: {
  activite: string;
  jour: Jour;
  heureDebut: string;
  heureFin: string;
  lieu: string;
  capacite: number;
  animateur?: string;
}[] = [
  { activite: "Yoga", jour: "LUNDI", heureDebut: "12:15", heureFin: "13:15", lieu: "Dojo Langevin Wallon", capacite: 10, animateur: "Nadia BENALI" },
  { activite: "Musculation", jour: "MARDI", heureDebut: "12:15", heureFin: "13:45", lieu: "Stade municipal", capacite: 10, animateur: "Thomas RENARD" },
  { activite: "Renforcement musculaire", jour: "MERCREDI", heureDebut: "18:00", heureFin: "19:00", lieu: "Centre administratif — salle de formation", capacite: 18, animateur: "Sofia MARTINEZ" },
  { activite: "Musculation", jour: "JEUDI", heureDebut: "12:15", heureFin: "13:45", lieu: "Stade municipal", capacite: 10, animateur: "Thomas RENARD" },
  { activite: "Aquagym", jour: "JEUDI", heureDebut: "12:15", heureFin: "13:15", lieu: "Bassin Langevin Wallon", capacite: 20, animateur: "Claire MOREAU" },
];

const ANIMATEURS = [
  { prenom: "Nadia", nom: "BENALI", organisme: "Association Yoga & Bien-être", acces: "LIEN" as const, email: "nadia.benali@example.org" },
  { prenom: "Thomas", nom: "RENARD", organisme: "Service des sports", acces: "AD" as const, login: "trenard", email: "t.renard@collectivite.fr" },
  { prenom: "Claire", nom: "MOREAU", organisme: "Piscine municipale", acces: "LOCAL" as const, login: "cmoreau", email: "c.moreau@collectivite.fr" },
  { prenom: "Sofia", nom: "MARTINEZ", organisme: "Prestataire Zumba Cité", acces: "LIEN" as const, email: "sofia.martinez@example.org" },
];

const DIRECTIONS = [
  { direction: "Direction des Services Techniques", services: ["Voirie", "Bâtiments", "Espaces verts"] },
  { direction: "Direction Générale", services: ["DSI", "Ressources humaines", "Finances"] },
  { direction: "Direction de l'Éducation", services: ["Écoles", "Périscolaire", "Petite enfance"] },
  { direction: "Direction de la Culture", services: ["Médiathèque", "Conservatoire"] },
];

const PRENOMS = ["Camille", "Julien", "Sarah", "Marc", "Léa", "Antoine", "Fatima", "Nicolas", "Émilie", "Karim", "Sylvie", "Pierre", "Aïcha", "Laurent", "Chloé", "David", "Nathalie", "Mehdi", "Céline", "Olivier", "Sandra", "Hugo", "Valérie", "Samuel", "Isabelle", "Franck", "Amina", "Bruno", "Julie", "Stéphane"];
const NOMS = ["MARTIN", "BERNARD", "DUBOIS", "THOMAS", "ROBERT", "RICHARD", "PETIT", "DURAND", "LEROY", "MOREL", "FOURNIER", "GIRARD", "BONNET", "LAMBERT", "FONTAINE", "ROUSSEAU", "VINCENT", "MULLER", "LEFEVRE", "FAURE", "ANDRE", "MERCIER", "BLANC", "GUERIN", "BOYER", "GARNIER", "CHEVALIER", "FRANCOIS", "LEGRAND", "GAUTHIER"];

const NB_AGENTS = 30;
/** Agents dotés d'un mot de passe local, pour essayer le parcours d'inscription. */
const NB_COMPTES_ESSAI = 3;

// ── Outils ──────────────────────────────────────────────────────────────────

/**
 * Générateur pseudo-aléatoire déterministe (mulberry32) : le jeu est
 * reproductible d'un chargement à l'autre. `Math.imul` garde l'arithmétique en
 * entiers 32 bits — sans lui, les produits dépassent la précision des doubles.
 */
function creerAlea(graine: number) {
  let etat = graine >>> 0;
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * La saison est calée sur la date de chargement, et non sur des dates fixes.
 *
 * Une saison entièrement future ne produirait aucun historique — donc des
 * statistiques vides — et une saison entièrement passée ne laisserait aucune
 * séance à émarger aujourd'hui. Or c'est précisément ce que l'on veut montrer.
 * On encadre donc la date du jour : environ quatre mois derrière, huit devant.
 */
function calculerSaison(today: Date) {
  const debut = ajouterJours(today, -16 * 7);
  // Caler le début sur un lundi, pour un calendrier lisible.
  debut.setUTCDate(debut.getUTCDate() - ((debut.getUTCDay() + 6) % 7));
  const fin = ajouterJours(today, 36 * 7);
  return { nom: `${debut.getUTCFullYear()}-${fin.getUTCFullYear()}`, debut, fin };
}

/**
 * Créneau tiré au sort, les premiers de la liste étant les plus demandés.
 *
 * Un tirage uniforme donnait un monde plat : quarante inscriptions réparties
 * sur sept créneaux, aucun jamais complet, et donc pas une seule liste
 * d'attente à montrer — alors que c'est l'écran sur lequel le service des
 * sports passe le plus de temps. Dans une vraie collectivité, deux ou trois
 * activités concentrent les demandes et refusent du monde pendant que d'autres
 * cherchent des inscrits. La racine carrée produit exactement cela.
 */
function creneauDemande(tirage: number, total = CRENEAUX.length): number {
  return Math.floor(tirage * tirage * total);
}

/** Premier agent de la liste qui n'a encore rien demandé sur ce créneau. */
async function agentDisponible(creneauId: string, agents: string[]): Promise<string | null> {
  const pris = new Set(
    (
      await prisma.inscription.findMany({ where: { creneauId }, select: { userId: true } })
    ).map((i) => i.userId),
  );
  return agents.find((id) => !pris.has(id)) ?? null;
}

/** Retrait des diacritiques, pour un identifiant de domaine réaliste. */
function sansAccent(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Mot de passe des comptes du jeu, tiré à chaque chargement.
 *
 * Un mot de passe figé dans le code serait une porte connue de quiconque a lu
 * le dépôt : ces comptes n'ont beau être que des agents, ils voient le
 * catalogue et s'inscrivent. Tiré, il n'est lisible qu'une fois — sur l'écran
 * qui vient de le créer.
 */
export function motDePasseDeTest(): string {
  return `test-${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
}

// ── Ce que le chargement renvoie ────────────────────────────────────────────

export type CompteDeTest = { login: string; qui: string };

export type ResultatJeuDeTest = {
  saison: string;
  activites: number;
  creneaux: number;
  seances: number;
  animateurs: number;
  agents: number;
  inscriptions: number;
  presences: number;
  demandes: number;
  motDePasse: string;
  comptes: CompteDeTest[];
};

/**
 * Ce qui s'oppose au chargement : des données d'exploitation déjà là.
 *
 * Le journal est exclu du compte, et lui seul : la remise à zéro y écrit sa
 * propre ligne juste après avoir vidé la base, si bien qu'une base fraîchement
 * remise à zéro n'est jamais tout à fait vide. Compter cette ligne reviendrait
 * à interdire le seul enchaînement qui a du sens.
 */
export async function donneesDejaPresentes(): Promise<number> {
  const decompte = await compterAReinitialiser();
  return Object.entries(decompte)
    .filter(([quoi]) => quoi !== "journal")
    .reduce((total, [, combien]) => total + combien, 0);
}

/**
 * Installe le jeu de test. Renvoie de quoi le raconter à l'écran.
 *
 * Ne vérifie pas que la base est vide : c'est à l'appelant de le faire (voir
 * `donneesDejaPresentes`), parce que le seed en ligne de commande, lui, a le
 * droit de repasser sur son propre jeu.
 */
export async function chargerJeuDeTest(
  options: { motDePasse?: string } = {},
): Promise<ResultatJeuDeTest> {
  const alea = creerAlea(20260928);
  const motDePasse = options.motDePasse ?? motDePasseDeTest();
  const empreinte = await bcrypt.hash(motDePasse, 12);
  const today = aujourdhui();
  const cadre = calculerSaison(today);
  const comptes: CompteDeTest[] = [];

  // ── Saison et périodes de fermeture ──────────────────────────────────────
  const saison = await prisma.saison.upsert({
    where: { nom: cadre.nom },
    update: { debut: cadre.debut, fin: cadre.fin, active: true },
    create: { nom: cadre.nom, debut: cadre.debut, fin: cadre.fin, active: true },
  });
  await prisma.saison.updateMany({
    where: { id: { not: saison.id } },
    data: { active: false },
  });

  // Fermetures positionnées relativement au début de saison : deux déjà
  // passées — elles creusent la courbe de fréquentation, ce qui rend le
  // graphique parlant — et deux à venir. Les libellés sont déduits des dates
  // réelles : la saison étant calée sur le jour du chargement, des noms figés
  // (« Noël », « hiver ») finiraient par désigner autre chose.
  const semaine = (n: number) => ajouterJours(cadre.debut, n * 7);
  const periode = (n: number, semaines: number) => {
    const debut = semaine(n);
    return {
      libelle: `Vacances scolaires — ${fmtMois(debut)}`,
      debut,
      fin: ajouterJours(semaine(n + semaines), -1),
    };
  };
  const pont = semaine(42);
  if ((await prisma.fermeture.count({ where: { saisonId: saison.id } })) === 0) {
    await prisma.fermeture.createMany({
      data: [
        periode(4, 2),
        periode(12, 2),
        periode(24, 2),
        periode(34, 2),
        { libelle: `Jour férié et pont — ${fmtMois(pont)}`, debut: pont, fin: ajouterJours(pont, 1) },
      ].map((f) => ({ saisonId: saison.id, ...f })),
    });
  }

  // ── Activités ────────────────────────────────────────────────────────────
  const activites = new Map<string, string>();
  for (const a of ACTIVITES) {
    const row = await prisma.activite.upsert({
      where: { nom: a.nom },
      update: {
        couleur: a.couleur,
        icone: a.icone,
        description: a.description,
        suiviPresence: a.suiviPresence ?? true,
        capacitePartagee: a.capacitePartagee ?? false,
        capacite: a.capacite ?? null,
      },
      create: a,
    });
    activites.set(a.nom, row.id);
  }

  // ── Lieux ────────────────────────────────────────────────────────────────
  // Le référentiel précède les créneaux : sans lui, leur lieu ne serait pas
  // proposé dans la liste au premier écran de modification.
  for (const [i, nom] of [...new Set(CRENEAUX.map((c) => c.lieu))].entries()) {
    await prisma.lieu.upsert({ where: { nom }, update: {}, create: { nom, ordre: i } });
  }

  // ── Animateurs ───────────────────────────────────────────────────────────
  const coachs = new Map<string, string>();
  for (const c of ANIMATEURS) {
    const cle = `${c.prenom} ${c.nom}`;
    let userId: string | null = null;
    if ("login" in c && c.login) {
      const u = await prisma.user.upsert({
        where: { login: c.login },
        update: { role: "COACH" },
        create: {
          login: c.login,
          displayName: cle,
          email: c.email,
          role: "COACH",
          isLocal: c.acces === "LOCAL",
          ...(c.acces === "LOCAL" ? { passwordHash: empreinte } : {}),
        },
      });
      userId = u.id;
      if (c.acces === "LOCAL") comptes.push({ login: c.login, qui: `${cle} — animatrice` });
    }
    const existant = await prisma.coach.findFirst({ where: { nom: c.nom, prenom: c.prenom } });
    const row = existant
      ? await prisma.coach.update({
          where: { id: existant.id },
          data: { acces: c.acces, userId, email: c.email, organisme: c.organisme },
        })
      : await prisma.coach.create({
          data: {
            nom: c.nom,
            prenom: c.prenom,
            email: c.email,
            organisme: c.organisme,
            acces: c.acces,
            userId,
          },
        });
    coachs.set(cle, row.id);
  }

  // ── Créneaux ─────────────────────────────────────────────────────────────
  const creneaux: string[] = [];
  for (const c of CRENEAUX) {
    const activiteId = activites.get(c.activite)!;
    const existant = await prisma.creneau.findFirst({
      where: { saisonId: saison.id, activiteId, jour: c.jour, heureDebut: c.heureDebut },
    });
    // Le renforcement musculaire est co-animé : deux intervenants se relaient,
    // chacun voit le créneau sur sa propre feuille — c'est le cas que le modèle
    // doit couvrir, et que rien ne montre tant que personne ne l'a saisi.
    const coAnim =
      c.activite === "Renforcement musculaire" ? coachs.get("Thomas RENARD") : undefined;
    const rattaches = [c.animateur ? coachs.get(c.animateur) : undefined, coAnim]
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id }));

    const data = {
      saisonId: saison.id,
      activiteId,
      jour: c.jour,
      heureDebut: c.heureDebut,
      heureFin: c.heureFin,
      lieu: c.lieu,
      capacite: c.capacite,
    };
    const row = existant
      ? await prisma.creneau.update({
          where: { id: existant.id },
          data: { ...data, animateurs: { set: rattaches } },
        })
      : await prisma.creneau.create({
          data: { ...data, animateurs: { connect: rattaches } },
        });
    creneaux.push(row.id);
  }

  // ── Dérogations de vacances ──────────────────────────────────────────────
  // La musculation en libre accès tourne pendant les petites vacances : cas
  // réel, et cela montre que la fermeture est réglable créneau par créneau.
  const fermetures = await prisma.fermeture.findMany({
    where: { saisonId: saison.id },
    orderBy: { debut: "asc" },
  });
  // Toutes sauf une : même la salle de musculation ferme sur la plus longue
  // coupure de l'année.
  const maintenues = fermetures.filter((_, i) => i !== 1).map((f) => ({ id: f.id }));
  const ouvertsEnVacances = await prisma.creneau.findMany({
    where: { saisonId: saison.id, activite: { nom: "Musculation" } },
    select: { id: true },
  });
  for (const { id } of ouvertsEnVacances) {
    await prisma.creneau.update({
      where: { id },
      data: { fermeturesMaintenues: { set: maintenues } },
    });
  }

  // ── Agents ───────────────────────────────────────────────────────────────
  const agents: string[] = [];
  for (let i = 0; i < NB_AGENTS; i++) {
    const prenom = PRENOMS[i % PRENOMS.length];
    const nom = NOMS[i % NOMS.length];
    const dir = DIRECTIONS[i % DIRECTIONS.length];
    const login = `${sansAccent(prenom)}.${nom.toLowerCase()}`;
    // Les premiers agents reçoivent un mot de passe local : sans annuaire
    // branché, c'est le seul moyen d'essayer le parcours « agent » (catalogue,
    // inscription, liste d'attente, historique). Les autres restent des
    // comptes d'annuaire fictifs, comme en production.
    const essai = i < NB_COMPTES_ESSAI;
    const u = await prisma.user.upsert({
      where: { login },
      update: essai ? { isLocal: true, passwordHash: empreinte } : {},
      create: {
        login,
        displayName: `${prenom} ${nom}`,
        email: `${login}@collectivite.fr`,
        role: "AGENT",
        direction: dir.direction,
        service: dir.services[i % dir.services.length],
        ...(essai ? { isLocal: true, passwordHash: empreinte } : {}),
      },
    });
    if (essai) comptes.push({ login, qui: `${prenom} ${nom} — agent` });
    agents.push(u.id);
  }

  // Un participant sans compte de domaine — vacataire, élu, agent d'un autre
  // organisme. Il n'a pas de mot de passe : sa porte est le lien e-mail. Les
  // écrans qui le concernent (« adresse perso » au lieu d'un identifiant, fiche
  // sans rattachement AD) n'ont sinon jamais de quoi s'afficher.
  const horsAnnuaire =
    (await prisma.user.findFirst({ where: { login: { startsWith: PREFIXE_HORS_ANNUAIRE } } })) ??
    (await prisma.user.create({
      data: {
        login: `${PREFIXE_HORS_ANNUAIRE}wilfried.pasquier`,
        displayName: "Wilfried PASQUIER",
        emailContact: "wilfried.pasquier@example.org",
        role: "AGENT",
        service: "Piscine municipale",
        isLocal: false,
      },
    }));
  agents.push(horsAnnuaire.id);

  // ── Calendrier ───────────────────────────────────────────────────────────
  const gen = await genererSeancesSaison(saison.id);

  // ── Inscriptions ─────────────────────────────────────────────────────────
  // Chaque agent s'inscrit à une ou deux activités ; les créneaux les plus
  // demandés débordent en liste d'attente, comme dans la vraie vie.
  if ((await prisma.inscription.count()) === 0) {
    for (const userId of agents) {
      const nb = alea() < 0.35 ? 2 : 1;
      const choisis = new Set<number>();
      while (choisis.size < nb) choisis.add(creneauDemande(alea(), creneaux.length));
      // L'inscription est datée du début de saison, sauf pour un agent sur six
      // qui rejoint en cours de route. C'est cette date qui fait foi partout :
      // la participation démarre à l'inscription, pas au début de l'activité.
      // Une inscription datée du jour du chargement aurait exclu tout
      // l'historique — feuilles manquantes, décrocheurs et assiduité seraient
      // restés vides.
      const rejoint = alea() < 0.17 ? ajouterJours(cadre.debut, 8 * 7) : cadre.debut;
      for (const idx of choisis) {
        const creneauId = creneaux[idx];
        // Les places se comptent avec les règles de l'application : sur le
        // créneau, ou sur l'activité entière quand celle-ci n'ouvre qu'un
        // groupe.
        const libre = await placeDisponiblePour(creneauId, userId);
        await prisma.inscription.create({
          data: {
            creneauId,
            userId,
            statut: libre ? "VALIDEE" : "LISTE_ATTENTE",
            rang: libre ? null : await prochainRang(creneauId),
            demandeAt: rejoint,
            decisionAt: rejoint,
            decidePar: "jeu de test",
          },
        });
      }
    }

    // Quelques demandes laissées à arbitrer par le service des sports, et deux
    // dossiers clos — sans eux, les statuts « refusée » et « désistée » ne
    // s'affichent jamais, alors qu'ils portent chacun leur motif à l'écran.
    //
    // L'agent est cherché parmi ceux qui ne sont pas déjà sur le créneau :
    // désigner un rang fixe dans la liste faisait échouer une création sur deux
    // contre l'unicité (créneau, agent), au gré du tirage. Un jeu de test qui
    // n'a pas toujours la même forme ne prouve pas grand-chose.
    const clos = [
      { statut: "REFUSEE" as const, motif: "Créneau réservé aux agents du secteur." },
      { statut: "DESISTEE" as const, motif: "Changement d'horaires de service." },
    ];
    for (const [i, c] of clos.entries()) {
      const creneauId = creneaux[(i + 2) % creneaux.length];
      const userId = await agentDisponible(creneauId, agents);
      if (!userId) continue;
      await prisma.inscription.create({
        data: {
          creneauId,
          userId,
          statut: c.statut,
          motif: c.motif,
          demandeAt: ajouterJours(cadre.debut, 3),
          decisionAt: ajouterJours(cadre.debut, 5),
          decidePar: "jeu de test",
        },
      });
    }
    for (let i = 0; i < 4; i++) {
      const creneauId = creneaux[i % creneaux.length];
      const userId = await agentDisponible(creneauId, [...agents].reverse());
      if (!userId) continue;
      await prisma.inscription.create({
        data: {
          creneauId,
          userId,
          statut: "EN_ATTENTE",
          commentaire: i === 0 ? "Je peux venir dès la première séance." : null,
        },
      });
    }
  }

  // ── Historique de fréquentation ──────────────────────────────────────────
  // On émarge les séances passées : sans historique, toutes les statistiques
  // seraient vides et l'application ne montrerait rien de ce qu'elle sait
  // faire. Les activités sans émargement en sont exclues — y poser des
  // présences serait précisément l'erreur que `suiviPresence` évite.
  const passees = await prisma.seance.findMany({
    where: {
      date: { lt: today },
      statut: "PLANIFIEE",
      creneau: { activite: { suiviPresence: true } },
    },
    include: {
      creneau: {
        include: {
          inscriptions: {
            where: { statut: "VALIDEE" },
            select: { id: true, userId: true, demandeAt: true, decisionAt: true },
          },
        },
      },
    },
    orderBy: { date: "asc" },
  });

  // La dernière séance passée de chaque créneau reste volontairement non
  // émargée : c'est ce qui alimente la section « À compléter » de l'animateur
  // et le compteur « feuilles non transmises » du tableau de bord.
  const aLaisser = new Set<string>();
  for (const creneauId of new Set(passees.map((s) => s.creneauId))) {
    const derniere = [...passees].reverse().find((s) => s.creneauId === creneauId);
    if (derniere) aLaisser.add(derniere.id);
  }

  const presences: {
    seanceId: string;
    userId: string;
    inscriptionId: string;
    etat: EtatPresence;
    saisiPar: string;
  }[] = [];
  const cloturees: string[] = [];
  const annulees: string[] = [];

  for (const seance of passees) {
    if (aLaisser.has(seance.id)) continue;
    // Une séance sur vingt n'a pas eu lieu.
    if (alea() < 0.05) {
      annulees.push(seance.id);
      continue;
    }
    // Une séance sur quinze reste non émargée : le tableau de bord doit
    // pouvoir signaler les feuilles manquantes.
    if (alea() < 0.07) continue;

    for (const inscription of seance.creneau.inscriptions) {
      // Un agent arrivé en cours de saison ne figurait pas sur les feuilles
      // antérieures : lui inventer une présence le créditerait d'une assiduité
      // sur des séances qui ne le concernaient pas.
      if (!participeALaSeance(inscription, seance.date)) continue;
      presences.push({
        seanceId: seance.id,
        userId: inscription.userId,
        inscriptionId: inscription.id,
        etat: alea() < 0.79 ? "PRESENT" : "ABSENT",
        saisiPar: "jeu de test",
      });
    }
    cloturees.push(seance.id);
  }

  // En une fois : une insertion par présence, c'est un millier d'allers-retours
  // pour un écran qui attend.
  await prisma.presence.createMany({ data: presences, skipDuplicates: true });
  await prisma.$transaction([
    prisma.seance.updateMany({
      where: { id: { in: annulees } },
      data: { statut: "ANNULEE", motifAnnulation: "Salle indisponible" },
    }),
    // `clotureeAt` vaut la date du chargement et non celle de la séance : une
    // seule requête pour toutes, et cet horodatage ne sert qu'à dire que la
    // feuille est close.
    prisma.seance.updateMany({
      where: { id: { in: cloturees } },
      data: { statut: "FAITE", clotureeAt: new Date(), clotureePar: "jeu de test" },
    }),
  ]);

  // ── Ce qui se prépare pour les séances à venir ───────────────────────────
  // Absences annoncées et participations ponctuelles : deux choses que
  // l'animateur lit sur sa feuille avant de pointer, et qui n'apparaissent
  // nulle part tant que personne ne les a saisies.
  const prochaines = await prisma.seance.findMany({
    where: { date: { gte: today, lte: ajouterJours(today, 14) }, statut: "PLANIFIEE" },
    include: {
      creneau: {
        include: {
          inscriptions: {
            where: { statut: "VALIDEE" },
            select: { userId: true },
            take: 3,
          },
        },
      },
    },
    orderBy: { date: "asc" },
    take: 6,
  });
  const motifs = ["Congés", "Réunion de service", "Rendez-vous médical"];
  for (const [i, s] of prochaines.entries()) {
    const inscrit = s.creneau.inscriptions[0];
    if (inscrit) {
      await prisma.absenceAnnoncee
        .create({
          data: { seanceId: s.id, userId: inscrit.userId, motif: motifs[i % motifs.length] },
        })
        .catch(() => {});
    }
    // Un agent qui vient essayer une séance sans s'engager sur la saison.
    const inscrits = new Set(s.creneau.inscriptions.map((x) => x.userId));
    const curieux = agents.find((id) => !inscrits.has(id));
    if (curieux && i % 2 === 0) {
      await prisma.participationPonctuelle
        .create({ data: { seanceId: s.id, userId: curieux, ajoutePar: "jeu de test" } })
        .catch(() => {});
    }
  }

  // ── Demandes d'accès ─────────────────────────────────────────────────────
  // Déposées depuis Internet par des personnes absentes de l'annuaire. Deux
  // attendent une décision, une a été refusée : la file du service des sports
  // n'est pas un écran vide dans la vraie vie.
  let demandes = await prisma.demandeAcces.count();
  if (demandes === 0) {
    await prisma.demandeAcces.createMany({
      data: [
        {
          nom: "Wilfried PASQUIER",
          email: "wilfried.pasquier@example.org",
          service: "Piscine municipale",
          message: "Vacataire à la piscine jusqu'en juin, je voudrais suivre l'aquagym.",
          createdAt: ajouterJours(today, -3),
        },
        {
          nom: "Hélène VASSEUR",
          email: "helene.vasseur@example.org",
          service: "Élue au conseil municipal",
          message: "Je n'ai pas de compte informatique à la mairie.",
          createdAt: ajouterJours(today, -1),
        },
        {
          nom: "Adresse inconnue",
          email: "contact@example.com",
          service: "Société de nettoyage",
          statut: "REFUSEE",
          motif: "Prestataire extérieur, hors périmètre des activités agents.",
          decidePar: "jeu de test",
          decideAt: ajouterJours(today, -6),
          createdAt: ajouterJours(today, -8),
        },
      ],
    });
    demandes = 3;
  }

  // ── Journal ──────────────────────────────────────────────────────────────
  // Quelques lignes d'exemple, toutes signées « jeu de test » : le journal est
  // une preuve, et une preuve fabriquée doit se reconnaître comme telle.
  await prisma.auditLog.createMany({
    data: [
      { action: "ACTIVITE_CREEE", cible: "Yoga" },
      { action: "ANIMATEUR_CREE", cible: "Nadia BENALI" },
      { action: "FERMETURE_AJOUTEE", cible: cadre.nom },
      { action: "INSCRIPTION_VALIDEE", cible: "Camille MARTIN", details: "Yoga — lundi 12:15" },
      { action: "INSCRIPTION_REFUSEE", cible: "Sylvie FOURNIER", details: "créneau complet" },
      { action: "EMARGEMENT_ACCES", cible: "Thomas RENARD" },
      { action: "DEMANDE_ACCES_DEPOSEE", cible: "helene.vasseur@example.org" },
      { action: "CONNEXION", cible: "camille.martin" },
    ].map((l, i) => ({
      ...l,
      acteur: "jeu de test",
      createdAt: ajouterJours(today, -(8 - i)),
    })),
  });

  return {
    saison: cadre.nom,
    activites: ACTIVITES.length,
    creneaux: creneaux.length,
    seances: gen.creees + gen.existantes,
    animateurs: ANIMATEURS.length,
    agents: agents.length,
    inscriptions: await prisma.inscription.count(),
    presences: presences.length,
    demandes,
    motDePasse,
    comptes,
  };
}
