import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  demanderInscription,
  effectifsParActivite,
  inscrireDirectement,
  perimetreCapacite,
  placeDisponiblePour,
  placesRestantes,
  prochainRang,
  promouvoirListeAttente,
  renumeroterFile,
} from "../../src/lib/inscriptions";
import { setSetting } from "../../src/lib/settings";

/**
 * Moteur d'inscription — capacité, liste d'attente, promotions.
 *
 * Ces règles ne se vérifient pas par lecture : elles enchaînent des états
 * (validée → désistée → promue) et changent de sens selon que l'activité
 * mutualise ou non sa capacité. On les exécute donc sur une vraie base, contre
 * laquelle Prisma applique réellement `distinct`, les tris et les contraintes
 * d'unicité — un faux client les aurait approximés, et validé nos propres
 * erreurs.
 *
 *   DATABASE_URL=…/bolt_test npm run test:integration
 */

const prisma = new PrismaClient();

/** Contexte minimal : une saison, une activité, ses créneaux, des agents. */
type Contexte = {
  saisonId: string;
  activiteId: string;
  creneaux: string[];
  agents: string[];
};

async function contexte(options: {
  capacites: number[];
  partagee?: boolean;
  capaciteActivite?: number | null;
  agents: number;
}): Promise<Contexte> {
  const saison = await prisma.saison.create({
    data: {
      nom: `saison-${Math.round(process.hrtime()[1])}-${cle()}`,
      debut: new Date("2026-09-01T00:00:00Z"),
      fin: new Date("2027-06-30T00:00:00Z"),
      active: true,
    },
  });
  const activite = await prisma.activite.create({
    data: {
      nom: `activite-${cle()}`,
      capacitePartagee: options.partagee ?? false,
      capacite: options.capaciteActivite ?? null,
    },
  });
  const jours = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI"] as const;
  const creneaux: string[] = [];
  for (const [i, capacite] of options.capacites.entries()) {
    const c = await prisma.creneau.create({
      data: {
        saisonId: saison.id,
        activiteId: activite.id,
        jour: jours[i],
        heureDebut: "12:15",
        heureFin: "13:15",
        capacite,
      },
    });
    creneaux.push(c.id);
  }
  const agents: string[] = [];
  for (let i = 0; i < options.agents; i++) {
    const u = await prisma.user.create({
      data: { login: `agent-${cle()}-${i}`, displayName: `Agent ${i}` },
    });
    agents.push(u.id);
  }
  return { saisonId: saison.id, activiteId: activite.id, creneaux, agents };
}

let compteur = 0;
const cle = () => `${Date.now().toString(36)}${(compteur += 1)}`;

/** Statuts d'un créneau, dans l'ordre de la file. */
async function file(creneauId: string) {
  const rows = await prisma.inscription.findMany({
    where: { creneauId },
    orderBy: [{ rang: "asc" }, { demandeAt: "asc" }],
    select: { userId: true, statut: true, rang: true },
  });
  return rows;
}

before(async () => {
  assert.ok(
    /bolt_test/.test(process.env.DATABASE_URL ?? ""),
    "DATABASE_URL doit pointer sur bolt_test : ces tests écrivent et effacent.",
  );
});

beforeEach(async () => {
  // Ordre imposé par les clés étrangères.
  await prisma.presence.deleteMany();
  await prisma.inscription.deleteMany();
  await prisma.seance.deleteMany();
  await prisma.creneau.deleteMany();
  await prisma.activite.deleteMany();
  await prisma.saison.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  await setSetting("general", { validationRequise: false, maxInscriptionsParAgent: 0 });
});

after(async () => {
  await prisma.$disconnect();
});

describe("capacité par créneau", () => {
  it("compte les places sur le créneau seul", async () => {
    const c = await contexte({ capacites: [2, 2], agents: 3 });
    await demanderInscription(c.agents[0], c.creneaux[0]);
    await demanderInscription(c.agents[1], c.creneaux[0]);

    assert.equal(await placesRestantes(c.creneaux[0]), 0);
    // Le second créneau est un groupe distinct : il reste plein de places.
    assert.equal(await placesRestantes(c.creneaux[1]), 2);
  });

  it("bascule en liste d'attente au-delà de la capacité", async () => {
    const c = await contexte({ capacites: [1], agents: 3 });
    const r1 = await demanderInscription(c.agents[0], c.creneaux[0]);
    const r2 = await demanderInscription(c.agents[1], c.creneaux[0]);
    const r3 = await demanderInscription(c.agents[2], c.creneaux[0]);

    assert.ok(r1.ok && r2.ok && r3.ok);
    const rows = await file(c.creneaux[0]);
    assert.deepEqual(
      rows.map((r) => [r.statut, r.rang]),
      [
        ["LISTE_ATTENTE", 1],
        ["LISTE_ATTENTE", 2],
        ["VALIDEE", null],
      ],
    );
    assert.match(r2.message, /position 1/);
    assert.match(r3.message, /position 2/);
  });

  it("ne compte jamais une place en négatif", async () => {
    const c = await contexte({ capacites: [1], agents: 3 });
    // Deux inscriptions forcées : le service des sports a dépassé la capacité.
    await inscrireDirectement(c.creneaux[0], c.agents[0], "service");
    await prisma.inscription.create({
      data: { creneauId: c.creneaux[0], userId: c.agents[1], statut: "VALIDEE" },
    });
    assert.equal(await placesRestantes(c.creneaux[0]), 0);
  });

  it("refuse une seconde demande sur le même créneau", async () => {
    const c = await contexte({ capacites: [5], agents: 1 });
    await demanderInscription(c.agents[0], c.creneaux[0]);
    const seconde = await demanderInscription(c.agents[0], c.creneaux[0]);
    assert.equal(seconde.ok, false);
    assert.match(seconde.message, /déjà une demande/);
  });

  it("laisse se réinscrire après un désistement", async () => {
    const c = await contexte({ capacites: [5], agents: 1 });
    await demanderInscription(c.agents[0], c.creneaux[0]);
    await prisma.inscription.updateMany({
      where: { userId: c.agents[0] },
      data: { statut: "DESISTEE" },
    });
    const reprise = await demanderInscription(c.agents[0], c.creneaux[0]);
    assert.equal(reprise.ok, true);
    const rows = await file(c.creneaux[0]);
    assert.equal(rows.length, 1, "la reprise réutilise la ligne, sans doublon");
    assert.equal(rows[0].statut, "VALIDEE");
  });
});

describe("capacité mutualisée", () => {
  it("compte des agents, pas des inscriptions", async () => {
    const c = await contexte({
      capacites: [10, 10],
      partagee: true,
      capaciteActivite: 2,
      agents: 3,
    });
    // Le même agent sur les deux créneaux ne consomme qu'une place.
    await demanderInscription(c.agents[0], c.creneaux[0]);
    await demanderInscription(c.agents[0], c.creneaux[1]);
    assert.equal(await placesRestantes(c.creneaux[0]), 1);

    await demanderInscription(c.agents[1], c.creneaux[1]);
    assert.equal(await placesRestantes(c.creneaux[0]), 0);
    assert.equal(await placesRestantes(c.creneaux[1]), 0);
  });

  it("laisse un détenteur de place ajouter un second créneau, groupe complet", async () => {
    const c = await contexte({
      capacites: [10, 10],
      partagee: true,
      capaciteActivite: 1,
      agents: 2,
    });
    await demanderInscription(c.agents[0], c.creneaux[0]);
    assert.equal(await placesRestantes(c.creneaux[1]), 0, "le groupe est complet");
    // Il détient déjà la place : le second créneau ne lui en coûte pas une autre.
    assert.equal(await placeDisponiblePour(c.creneaux[1], c.agents[0]), true);
    // Un autre agent, lui, passe en file.
    assert.equal(await placeDisponiblePour(c.creneaux[1], c.agents[1]), false);
  });

  it("partage une file commune à l'activité", async () => {
    const c = await contexte({
      capacites: [10, 10],
      partagee: true,
      capaciteActivite: 1,
      agents: 3,
    });
    await demanderInscription(c.agents[0], c.creneaux[0]);
    await demanderInscription(c.agents[1], c.creneaux[0]);
    await demanderInscription(c.agents[2], c.creneaux[1]);
    // Les rangs se suivent d'un créneau à l'autre, sans repartir de 1.
    assert.equal(await prochainRang(c.creneaux[0]), 3);
    assert.equal(await prochainRang(c.creneaux[1]), 3);
  });

  it("ne libère pas de place quand l'agent garde l'autre créneau", async () => {
    const c = await contexte({
      capacites: [10, 10],
      partagee: true,
      capaciteActivite: 1,
      agents: 2,
    });
    await demanderInscription(c.agents[0], c.creneaux[0]);
    await demanderInscription(c.agents[0], c.creneaux[1]);
    await demanderInscription(c.agents[1], c.creneaux[0]); // en file

    // Il quitte un créneau mais garde l'autre : l'effectif du groupe ne bouge
    // pas, personne ne doit être promu.
    await prisma.inscription.updateMany({
      where: { userId: c.agents[0], creneauId: c.creneaux[1] },
      data: { statut: "DESISTEE", rang: null },
    });
    const promu = await promouvoirListeAttente(c.creneaux[0]);
    assert.equal(promu, null);
  });

  it("promeut sur toute l'activité quand la place est réellement rendue", async () => {
    const c = await contexte({
      capacites: [10, 10],
      partagee: true,
      capaciteActivite: 1,
      agents: 2,
    });
    await demanderInscription(c.agents[0], c.creneaux[0]);
    await demanderInscription(c.agents[1], c.creneaux[1]); // en file, sur l'autre créneau

    await prisma.inscription.updateMany({
      where: { userId: c.agents[0] },
      data: { statut: "DESISTEE", rang: null },
    });
    // Le désistement du lundi profite à qui attendait le mardi.
    const promu = await promouvoirListeAttente(c.creneaux[0]);
    assert.equal(promu?.userId, c.agents[1]);
  });

  it("valide d'un coup les autres attentes du promu", async () => {
    const c = await contexte({
      capacites: [10, 10],
      partagee: true,
      capaciteActivite: 1,
      agents: 2,
    });
    await demanderInscription(c.agents[0], c.creneaux[0]);
    await demanderInscription(c.agents[1], c.creneaux[0]);
    await demanderInscription(c.agents[1], c.creneaux[1]);

    await prisma.inscription.updateMany({
      where: { userId: c.agents[0] },
      data: { statut: "DESISTEE", rang: null },
    });
    await promouvoirListeAttente(c.creneaux[0]);

    const siennes = await prisma.inscription.findMany({
      where: { userId: c.agents[1] },
      select: { statut: true, rang: true },
    });
    assert.deepEqual(
      siennes.map((i) => i.statut).sort(),
      ["VALIDEE", "VALIDEE"],
      "sa place étant acquise, ses autres attentes ne coûtent rien",
    );
    assert.ok(siennes.every((i) => i.rang === null));
  });

  it("compte l'effectif de l'activité en agents distincts", async () => {
    const c = await contexte({
      capacites: [10, 10],
      partagee: true,
      capaciteActivite: 5,
      agents: 2,
    });
    await demanderInscription(c.agents[0], c.creneaux[0]);
    await demanderInscription(c.agents[0], c.creneaux[1]);
    await demanderInscription(c.agents[1], c.creneaux[0]);
    const effectifs = await effectifsParActivite(c.saisonId);
    assert.equal(effectifs.get(c.activiteId), 2);
  });

  it("ne partage pas les places entre deux saisons", async () => {
    const c = await contexte({
      capacites: [10],
      partagee: true,
      capaciteActivite: 5,
      agents: 1,
    });
    const autre = await prisma.saison.create({
      data: {
        nom: `saison-suivante-${cle()}`,
        debut: new Date("2027-09-01T00:00:00Z"),
        fin: new Date("2028-06-30T00:00:00Z"),
      },
    });
    await prisma.creneau.create({
      data: {
        saisonId: autre.id,
        activiteId: c.activiteId,
        jour: "LUNDI",
        heureDebut: "12:15",
        heureFin: "13:15",
        capacite: 10,
      },
    });
    const p = await perimetreCapacite(c.creneaux[0]);
    assert.deepEqual(p?.creneauIds, [c.creneaux[0]]);
  });
});

describe("file d'attente", () => {
  it("resserre les rangs après un départ", async () => {
    const c = await contexte({ capacites: [1], agents: 4 });
    for (const a of c.agents) await demanderInscription(a, c.creneaux[0]);

    // agents[0] est validé ; 1, 2, 3 attendent aux rangs 1, 2, 3.
    await prisma.inscription.updateMany({
      where: { userId: c.agents[1] },
      data: { statut: "DESISTEE", rang: null },
    });
    await renumeroterFile(c.creneaux[0]);

    const attente = (await file(c.creneaux[0])).filter((r) => r.statut === "LISTE_ATTENTE");
    assert.deepEqual(
      attente.map((r) => r.rang),
      [1, 2],
      "les positions restent contiguës",
    );
  });

  it("promeut dans l'ordre de la file", async () => {
    const c = await contexte({ capacites: [1], agents: 3 });
    for (const a of c.agents) await demanderInscription(a, c.creneaux[0]);
    await prisma.inscription.updateMany({
      where: { userId: c.agents[0] },
      data: { statut: "DESISTEE", rang: null },
    });
    const promu = await promouvoirListeAttente(c.creneaux[0]);
    assert.equal(promu?.userId, c.agents[1], "le premier arrivé passe d'abord");
  });

  it("ne promeut personne si le créneau reste plein", async () => {
    const c = await contexte({ capacites: [1], agents: 2 });
    for (const a of c.agents) await demanderInscription(a, c.creneaux[0]);
    assert.equal(await promouvoirListeAttente(c.creneaux[0]), null);
  });

  it("ne promeut personne si la file est vide", async () => {
    const c = await contexte({ capacites: [5], agents: 1 });
    await demanderInscription(c.agents[0], c.creneaux[0]);
    assert.equal(await promouvoirListeAttente(c.creneaux[0]), null);
  });
});

describe("quota d'activités par agent", () => {
  it("compte en activités, pas en créneaux", async () => {
    await setSetting("general", { validationRequise: false, maxInscriptionsParAgent: 1 });
    const c = await contexte({ capacites: [10, 10], agents: 1 });
    const premier = await demanderInscription(c.agents[0], c.creneaux[0]);
    // Second créneau de la MÊME activité : c'est toujours une seule activité.
    const second = await demanderInscription(c.agents[0], c.creneaux[1]);
    assert.equal(premier.ok, true);
    assert.equal(second.ok, true, "deux créneaux d'une même activité ne font qu'un engagement");
  });

  it("refuse au-delà du quota, sur une autre activité", async () => {
    await setSetting("general", { validationRequise: false, maxInscriptionsParAgent: 1 });
    const c = await contexte({ capacites: [10], agents: 1 });
    await demanderInscription(c.agents[0], c.creneaux[0]);

    const autre = await prisma.activite.create({ data: { nom: `autre-${cle()}` } });
    const creneauAutre = await prisma.creneau.create({
      data: {
        saisonId: c.saisonId,
        activiteId: autre.id,
        jour: "JEUDI",
        heureDebut: "12:15",
        heureFin: "13:15",
        capacite: 10,
      },
    });
    const refus = await demanderInscription(c.agents[0], creneauAutre.id);
    assert.equal(refus.ok, false);
    assert.match(refus.message, /limité à 1 activité/);
  });
});

describe("arbitrage", () => {
  it("met la demande en attente quand le service arbitre", async () => {
    await setSetting("general", { validationRequise: true, maxInscriptionsParAgent: 0 });
    const c = await contexte({ capacites: [5], agents: 1 });
    await demanderInscription(c.agents[0], c.creneaux[0]);
    const rows = await file(c.creneaux[0]);
    assert.equal(rows[0].statut, "EN_ATTENTE");
  });

  it("passe la file avant l'arbitrage quand le créneau est plein", async () => {
    await setSetting("general", { validationRequise: true, maxInscriptionsParAgent: 0 });
    const c = await contexte({ capacites: [1], agents: 2 });
    await inscrireDirectement(c.creneaux[0], c.agents[0], "service");
    await demanderInscription(c.agents[1], c.creneaux[0]);
    const rows = await file(c.creneaux[0]);
    const demande = rows.find((r) => r.userId === c.agents[1]);
    assert.equal(demande?.statut, "LISTE_ATTENTE");
  });

  it("l'animateur signale, il n'arbitre pas", async () => {
    const c = await contexte({ capacites: [5], agents: 1 });
    const res = await inscrireDirectement(c.creneaux[0], c.agents[0], null);
    assert.deepEqual(res, { deja: false, statut: "EN_ATTENTE", rang: null });
  });

  it("le service inscrit d'emblée, ou met en file", async () => {
    const c = await contexte({ capacites: [1], agents: 2 });
    const premier = await inscrireDirectement(c.creneaux[0], c.agents[0], "service");
    const second = await inscrireDirectement(c.creneaux[0], c.agents[1], "service");
    assert.deepEqual(premier, { deja: false, statut: "VALIDEE", rang: null });
    assert.deepEqual(second, { deja: false, statut: "LISTE_ATTENTE", rang: 1 });
  });

  it("ne repositionne pas un agent déjà placé", async () => {
    const c = await contexte({ capacites: [5], agents: 1 });
    await inscrireDirectement(c.creneaux[0], c.agents[0], "service");
    assert.deepEqual(await inscrireDirectement(c.creneaux[0], c.agents[0], "service"), {
      deja: true,
    });
  });
});

describe("créneau fermé ou hors saison", () => {
  it("refuse quand les inscriptions sont fermées", async () => {
    const c = await contexte({ capacites: [5], agents: 1 });
    await prisma.creneau.update({
      where: { id: c.creneaux[0] },
      data: { ouvertInscription: false },
    });
    const res = await demanderInscription(c.agents[0], c.creneaux[0]);
    assert.equal(res.ok, false);
    assert.match(res.message, /fermées/);
  });

  it("refuse sur une saison inactive", async () => {
    const c = await contexte({ capacites: [5], agents: 1 });
    await prisma.saison.update({ where: { id: c.saisonId }, data: { active: false } });
    const res = await demanderInscription(c.agents[0], c.creneaux[0]);
    assert.equal(res.ok, false);
    assert.match(res.message, /saison en cours/);
  });
});
