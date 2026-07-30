/**
 * Jeu de démonstration — les cinq activités de la rentrée, six créneaux
 * (musculation 2×/semaine), une trentaine d'agents fictifs, et un historique
 * de fréquentation vraisemblable pour que les statistiques aient du relief.
 *
 *   npm run db:seed
 *
 * Idempotent : relançable sans créer de doublon.
 */
import { PrismaClient, type EtatPresence, type Jour } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * La saison de démonstration est calée sur la date d'exécution, et non sur des
 * dates fixes.
 *
 * Une saison entièrement future ne produirait aucun historique — donc des
 * statistiques vides — et une saison entièrement passée ne laisserait aucune
 * séance à émarger aujourd'hui. Or c'est précisément ce que l'on veut montrer
 * au service des sports. On encadre donc la date du jour : environ quatre mois
 * derrière, huit devant.
 */
function calculerSaison() {
  const today = jourUtc(new Date());
  const debut = ajouterJours(today, -16 * 7);
  // Caler le début sur un lundi, pour un calendrier lisible.
  debut.setUTCDate(debut.getUTCDate() - ((debut.getUTCDay() + 6) % 7));
  const fin = ajouterJours(today, 36 * 7);
  return {
    nom: `${debut.getUTCFullYear()}-${fin.getUTCFullYear()}`,
    debut,
    fin,
    today,
  };
}

function ajouterJours(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

const ACTIVITES = [
  {
    nom: "Yoga",
    description: "Séance douce, tapis fournis, tous niveaux.",
    couleur: "#7c3aed",
    icone: "Flower2",
    ordre: 0,
  },
  {
    nom: "Musculation",
    description: "Salle équipée, accompagnement personnalisé.",
    couleur: "#4f46e5",
    icone: "Dumbbell",
    ordre: 1,
    // Un seul groupe de 12 agents, deux séances par semaine : chacun vient le
    // lundi, le jeudi ou les deux, sans occuper deux places.
    capacitePartagee: true,
    capacite: 12,
  },
  {
    nom: "Aquagym",
    description: "Piscine municipale, bassin réservé aux agents.",
    couleur: "#0891b2",
    icone: "Waves",
    ordre: 2,
  },
  {
    nom: "Renforcement musculaire",
    description: "Circuit training au poids du corps.",
    couleur: "#059669",
    icone: "Zap",
    ordre: 3,
  },
  {
    nom: "Zumba",
    description: "Cardio en musique, aucune expérience requise.",
    couleur: "#db2777",
    icone: "Music",
    ordre: 4,
  },
];

const CRENEAUX: {
  activite: string;
  jour: Jour;
  heureDebut: string;
  heureFin: string;
  lieu: string;
  capacite: number;
  animateur: string;
}[] = [
  { activite: "Yoga", jour: "MARDI", heureDebut: "12:15", heureFin: "13:15", lieu: "Salle polyvalente — Hôtel de Ville", capacite: 16, animateur: "Nadia BENALI" },
  { activite: "Musculation", jour: "LUNDI", heureDebut: "12:30", heureFin: "13:30", lieu: "Gymnase municipal — salle de musculation", capacite: 12, animateur: "Thomas RENARD" },
  { activite: "Musculation", jour: "JEUDI", heureDebut: "12:30", heureFin: "13:30", lieu: "Gymnase municipal — salle de musculation", capacite: 12, animateur: "Thomas RENARD" },
  { activite: "Aquagym", jour: "MERCREDI", heureDebut: "12:15", heureFin: "13:00", lieu: "Piscine municipale — petit bassin", capacite: 20, animateur: "Claire MOREAU" },
  { activite: "Renforcement musculaire", jour: "VENDREDI", heureDebut: "12:30", heureFin: "13:30", lieu: "Gymnase municipal — grande salle", capacite: 18, animateur: "Thomas RENARD" },
  { activite: "Zumba", jour: "MARDI", heureDebut: "17:45", heureFin: "18:45", lieu: "Salle des fêtes", capacite: 25, animateur: "Sofia MARTINEZ" },
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

/**
 * Générateur pseudo-aléatoire déterministe (mulberry32) : le jeu de démo est
 * reproductible d'une exécution à l'autre. `Math.imul` garde l'arithmétique en
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
const alea = creerAlea(20260928);

/** Ramène une date (ou une chaîne « AAAA-MM-JJ ») à minuit UTC. */
function jourUtc(v: string | Date): Date {
  const d = typeof v === "string" ? new Date(`${v}T00:00:00Z`) : v;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function main() {
  console.log("Bolt — jeu de démonstration");

  // ── Administrateur local ───────────────────────────────────────────────
  await prisma.user.upsert({
    where: { login: "admin" },
    update: {},
    create: {
      login: "admin",
      displayName: "Administrateur local",
      role: "ADMIN",
      isLocal: true,
      passwordHash: await bcrypt.hash(process.env.BOLT_ADMIN_PASSWORD || "bolt", 12),
    },
  });

  // Un gestionnaire de démonstration, pour montrer la vue « service des sports ».
  await prisma.user.upsert({
    where: { login: "sports" },
    update: { role: "GESTIONNAIRE" },
    create: {
      login: "sports",
      displayName: "Service des sports",
      email: "sports@collectivite.fr",
      role: "GESTIONNAIRE",
      isLocal: true,
      passwordHash: await bcrypt.hash("bolt", 12),
    },
  });

  // ── Paramètres ─────────────────────────────────────────────────────────
  await prisma.setting.upsert({
    where: { key: "general" },
    update: {},
    create: {
      key: "general",
      value: JSON.stringify({
        orgName: "Ville de démonstration",
        appUrl: process.env.BOLT_PUBLIC_URL ?? "http://localhost:3000",
        pointageUrl: process.env.BOLT_POINTAGE_URL ?? "",
        contactEmail: "sports@collectivite.fr",
        maxInscriptionsParAgent: 2,
        validationRequise: true,
        absencesAvantRelance: 3,
        lienMagiqueActif: false,
      }),
    },
  });

  // ── Saison et fermetures ───────────────────────────────────────────────
  const cadre = calculerSaison();
  const saison = await prisma.saison.upsert({
    where: { nom: cadre.nom },
    update: { debut: cadre.debut, fin: cadre.fin, active: true },
    create: { nom: cadre.nom, debut: cadre.debut, fin: cadre.fin, active: true },
  });
  await prisma.saison.updateMany({
    where: { id: { not: saison.id } },
    data: { active: false },
  });

  // Périodes de fermeture positionnées relativement au début de saison : deux
  // déjà passées (elles creusent la courbe de fréquentation, ce qui rend le
  // graphique parlant) et deux à venir.
  const semaine = (n: number) => ajouterJours(cadre.debut, n * 7);
  // Les libellés sont déduits des dates réelles : la saison de démonstration
  // étant calée sur le jour d'exécution, des noms figés (« Noël », « hiver »)
  // finiraient par désigner des périodes qui n'y correspondent pas.
  const mois = (d: Date) =>
    new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", month: "long", year: "numeric" })
      .format(d);
  const periode = (n: number, semaines: number) => {
    const debut = semaine(n);
    return {
      libelle: `Vacances scolaires — ${mois(debut)}`,
      debut,
      fin: ajouterJours(semaine(n + semaines), -1),
    };
  };
  const pont = semaine(42);
  const fermetures = [
    periode(4, 2),
    periode(12, 2),
    periode(24, 2),
    periode(34, 2),
    { libelle: `Jour férié et pont — ${mois(pont)}`, debut: pont, fin: ajouterJours(pont, 1) },
  ];
  if ((await prisma.fermeture.count({ where: { saisonId: saison.id } })) === 0) {
    await prisma.fermeture.createMany({
      data: fermetures.map((f) => ({ saisonId: saison.id, ...f })),
    });
  }

  // ── Activités ──────────────────────────────────────────────────────────
  const activites = new Map<string, string>();
  for (const a of ACTIVITES) {
    const row = await prisma.activite.upsert({
      where: { nom: a.nom },
      update: {
        couleur: a.couleur,
        icone: a.icone,
        description: a.description,
        capacitePartagee: "capacitePartagee" in a ? a.capacitePartagee : false,
        capacite: "capacite" in a ? a.capacite : null,
      },
      create: a,
    });
    activites.set(a.nom, row.id);
  }

  // ── Animateurs ─────────────────────────────────────────────────────────
  const coachs = new Map<string, string>();
  for (const c of ANIMATEURS) {
    const cle = `${c.prenom} ${c.nom}`;
    let userId: string | null = null;
    if (c.acces !== "LIEN" && "login" in c && c.login) {
      const u = await prisma.user.upsert({
        where: { login: c.login },
        update: { role: "COACH" },
        create: {
          login: c.login,
          displayName: cle,
          email: c.email,
          role: "COACH",
          isLocal: c.acces === "LOCAL",
          ...(c.acces === "LOCAL" ? { passwordHash: await bcrypt.hash("bolt", 12) } : {}),
        },
      });
      userId = u.id;
    }
    const existant = await prisma.coach.findFirst({
      where: { nom: c.nom, prenom: c.prenom },
    });
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

  // ── Lieux ──────────────────────────────────────────────────────────────
  // Le référentiel précède les créneaux : sans lui, leur lieu ne serait pas
  // proposé dans la liste au premier écran de modification.
  const lieux = [...new Set(CRENEAUX.map((c) => c.lieu))];
  for (const [i, nom] of lieux.entries()) {
    await prisma.lieu.upsert({
      where: { nom },
      update: {},
      create: { nom, ordre: i },
    });
  }

  // ── Créneaux ───────────────────────────────────────────────────────────
  const creneaux: string[] = [];
  for (const c of CRENEAUX) {
    const activiteId = activites.get(c.activite)!;
    const existant = await prisma.creneau.findFirst({
      where: { saisonId: saison.id, activiteId, jour: c.jour, heureDebut: c.heureDebut },
    });
    const anim = coachs.get(c.animateur);
    // La zumba est co-animée : deux intervenants se relaient, chacun voit le
    // créneau sur sa propre feuille — c'est le cas que le modèle doit couvrir.
    const coAnim = c.activite === "Zumba" ? coachs.get("Nadia BENALI") : undefined;
    const rattaches = [anim, coAnim].filter(Boolean).map((id) => ({ id: id as string }));

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

  // ── Dérogations de vacances ────────────────────────────────────────────
  // La musculation en libre accès tourne pendant les petites vacances : cas
  // réel, et cela montre que la fermeture est réglable créneau par créneau.
  const toutesFermetures = await prisma.fermeture.findMany({
    where: { saisonId: saison.id },
    orderBy: { debut: "asc" },
  });
  const muscuIds = (
    await prisma.creneau.findMany({
      where: { saisonId: saison.id, activite: { nom: "Musculation" } },
      select: { id: true },
    })
  ).map((c) => c.id);
  // Toutes sauf une : même la salle de musculation ferme sur la plus longue
  // coupure de l'année.
  const maintenues = toutesFermetures.filter((_, i) => i !== 1);
  for (const id of muscuIds) {
    await prisma.creneau.update({
      where: { id },
      data: { fermeturesMaintenues: { set: maintenues.map((f) => ({ id: f.id })) } },
    });
  }

  // ── Agents ─────────────────────────────────────────────────────────────
  const agents: string[] = [];
  const comptesDemo: string[] = [];
  const motDePasseDemo = await bcrypt.hash("bolt", 12);
  for (let i = 0; i < 30; i++) {
    const prenom = PRENOMS[i % PRENOMS.length];
    const nom = NOMS[i % NOMS.length];
    const dir = DIRECTIONS[i % DIRECTIONS.length];
    // Retrait des diacritiques (U+0300–U+036F) pour un identifiant réaliste.
    const sansAccent = prenom.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const login = `${sansAccent}.${nom.toLowerCase()}`;
    // Les trois premiers agents reçoivent un mot de passe local : sans annuaire
    // branché, c'est le seul moyen d'essayer le parcours « agent » (catalogue,
    // inscription, liste d'attente, historique). Les autres restent des comptes
    // AD fictifs, comme en production.
    const demo = i < 3;
    const u = await prisma.user.upsert({
      where: { login },
      update: demo ? { isLocal: true, passwordHash: motDePasseDemo } : {},
      create: {
        login,
        displayName: `${prenom} ${nom}`,
        email: `${login}@collectivite.fr`,
        role: "AGENT",
        direction: dir.direction,
        service: dir.services[i % dir.services.length],
        ...(demo ? { isLocal: true, passwordHash: motDePasseDemo } : {}),
      },
    });
    if (demo) comptesDemo.push(login);
    agents.push(u.id);
  }

  // ── Génération du calendrier ───────────────────────────────────────────
  const { genererSeancesSaison } = await import("../src/lib/seances");
  const gen = await genererSeancesSaison(saison.id);
  console.log(`  ${gen.creees} séances planifiées`);

  // ── Inscriptions ───────────────────────────────────────────────────────
  // Chaque agent s'inscrit à une ou deux activités ; les créneaux les plus
  // demandés débordent en liste d'attente, comme dans la vraie vie.
  if ((await prisma.inscription.count()) === 0) {
    // Les places se comptent avec les règles de l'application : sur le créneau,
    // ou sur l'activité entière quand celle-ci n'ouvre qu'un groupe.
    const { placeDisponiblePour, prochainRang } = await import("../src/lib/inscriptions");
    for (const userId of agents) {
      const nb = alea() < 0.35 ? 2 : 1;
      const choisis = new Set<number>();
      while (choisis.size < nb) choisis.add(Math.floor(alea() * creneaux.length));
      // L'inscription est datée du début de saison, sauf pour un agent sur six
      // qui rejoint en cours de route. C'est cette date qui fait foi partout :
      // la participation démarre à l'inscription, pas au début de l'activité.
      // Une inscription datée du jour du seed aurait exclu tout l'historique —
      // feuilles manquantes, décrocheurs et assiduité seraient restés vides.
      const rejoint = alea() < 0.17 ? ajouterJours(cadre.debut, 8 * 7) : cadre.debut;
      for (const idx of choisis) {
        const creneauId = creneaux[idx];
        const libre = await placeDisponiblePour(creneauId, userId);
        await prisma.inscription.create({
          data: {
            creneauId,
            userId,
            statut: libre ? "VALIDEE" : "LISTE_ATTENTE",
            rang: libre ? null : await prochainRang(creneauId),
            demandeAt: rejoint,
            decisionAt: rejoint,
            decidePar: "jeu de démonstration",
          },
        });
      }
    }
    // Quelques demandes laissées à arbitrer par le service des sports.
    for (let i = 0; i < 4; i++) {
      const userId = agents[agents.length - 1 - i];
      await prisma.inscription
        .create({
          data: {
            creneauId: creneaux[i % creneaux.length],
            userId,
            statut: "EN_ATTENTE",
            commentaire: i === 0 ? "Je peux venir dès la première séance." : null,
          },
        })
        .catch(() => {}); // l'agent est peut-être déjà inscrit à ce créneau
    }
  }

  // ── Historique de fréquentation ────────────────────────────────────────
  // On émarge les séances passées : sans historique, toutes les statistiques
  // seraient vides et la démonstration ne montrerait rien.
  const { participeALaSeance } = await import("../src/lib/inscriptions");
  const passees = await prisma.seance.findMany({
    where: { date: { lt: cadre.today }, statut: "PLANIFIEE" },
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

  let pointages = 0;
  for (const seance of passees) {
    if (aLaisser.has(seance.id)) continue;
    // Une séance sur vingt n'a pas eu lieu.
    if (alea() < 0.05) {
      await prisma.seance.update({
        where: { id: seance.id },
        data: { statut: "ANNULEE", motifAnnulation: "Salle indisponible" },
      });
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
      const etat: EtatPresence = alea() < 0.79 ? "PRESENT" : "ABSENT";
      await prisma.presence.upsert({
        where: { seanceId_userId: { seanceId: seance.id, userId: inscription.userId } },
        update: {},
        create: {
          seanceId: seance.id,
          userId: inscription.userId,
          inscriptionId: inscription.id,
          etat,
          saisiPar: "jeu de démonstration",
        },
      });
      pointages += 1;
    }
    await prisma.seance.update({
      where: { id: seance.id },
      data: { statut: "FAITE", clotureeAt: seance.date, clotureePar: "jeu de démonstration" },
    });
  }

  console.log(`  ${agents.length} agents, ${creneaux.length} créneaux, ${pointages} pointages`);
  console.log("");
  console.log("  Comptes de démonstration (mot de passe : bolt)");
  console.log("    admin    — administrateur (DSI)");
  console.log("    sports   — service des sports");
  console.log("    cmoreau  — animatrice, compte local");
  for (const c of comptesDemo) console.log(`    ${c.padEnd(20)} — agent`);
  console.log("");
  console.log("  Animateurs par lien : générez leur lien depuis Animateurs.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
