import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { demanderInscription } from "../../src/lib/inscriptions";
import {
  compterInscriptionsVivantes,
  desactiverCompte,
  desinscrireDeTout,
} from "../../src/lib/departs";
import { setSetting } from "../../src/lib/settings";

/**
 * Départs — désactivation d'un compte et retrait de ses activités.
 *
 * Ce code désactive des comptes et retire des inscriptions en série : c'est le
 * plus destructeur de l'application. Deux propriétés doivent tenir, et ne se
 * vérifient pas par lecture du code :
 *
 *  • la place libérée profite immédiatement au premier de la liste d'attente —
 *    sinon un départ laisse un créneau à moitié vide et une file qui attend ;
 *  • les présences déjà émargées survivent au départ, sans quoi la
 *    fréquentation des séances passées se met à mentir. C'est la raison d'être
 *    du choix « DESISTEE plutôt que suppression », et c'est ce qui est vérifié
 *    ici plutôt que supposé.
 *
 *   npm run test:integration
 */

const prisma = new PrismaClient();

let compteur = 0;
const cle = () => `${Date.now().toString(36)}${(compteur += 1)}`;

async function contexte(options: { capacite: number; agents: number }) {
  const saison = await prisma.saison.create({
    data: {
      nom: `saison-${cle()}`,
      debut: new Date("2026-09-01T00:00:00Z"),
      fin: new Date("2027-06-30T00:00:00Z"),
      active: true,
    },
  });
  const activite = await prisma.activite.create({ data: { nom: `activite-${cle()}` } });
  const creneau = await prisma.creneau.create({
    data: {
      saisonId: saison.id,
      activiteId: activite.id,
      jour: "LUNDI",
      heureDebut: "12:15",
      heureFin: "13:15",
      capacite: options.capacite,
    },
  });
  const agents: string[] = [];
  for (let i = 0; i < options.agents; i++) {
    const u = await prisma.user.create({
      data: { login: `agent-${cle()}-${i}`, displayName: `Agent ${i}` },
    });
    agents.push(u.id);
  }
  return { saisonId: saison.id, creneauId: creneau.id, agents };
}

before(async () => {
  assert.ok(
    /bolt_test/.test(process.env.DATABASE_URL ?? ""),
    "DATABASE_URL doit pointer sur bolt_test : ces tests écrivent et effacent.",
  );
});

beforeEach(async () => {
  await prisma.presence.deleteMany();
  await prisma.participationPonctuelle.deleteMany();
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

describe("desinscrireDeTout", () => {
  it("retire les inscriptions vivantes et rend la place au suivant", async () => {
    const c = await contexte({ capacite: 1, agents: 2 });
    await demanderInscription(c.agents[0], c.creneauId); // validé
    await demanderInscription(c.agents[1], c.creneauId); // liste d'attente

    const res = await desinscrireDeTout(c.agents[0], "Test", "départ");

    assert.equal(res.inscriptionsRetirees, 1);
    assert.equal(res.promotions.length, 1, "le suivant doit être promu");

    const parti = await prisma.inscription.findFirst({ where: { userId: c.agents[0] } });
    assert.equal(parti?.statut, "DESISTEE");
    assert.equal(parti?.rang, null);
    assert.equal(parti?.motif, "départ");

    const promu = await prisma.inscription.findFirst({ where: { userId: c.agents[1] } });
    assert.equal(promu?.statut, "VALIDEE", "la place libérée doit être reprise");
  });

  it("conserve les présences déjà émargées", async () => {
    const c = await contexte({ capacite: 2, agents: 1 });
    await demanderInscription(c.agents[0], c.creneauId);
    const seance = await prisma.seance.create({
      data: { creneauId: c.creneauId, date: new Date("2026-09-14T00:00:00Z") },
    });
    const inscription = await prisma.inscription.findFirstOrThrow({
      where: { userId: c.agents[0] },
    });
    await prisma.presence.create({
      data: {
        seanceId: seance.id,
        userId: c.agents[0],
        inscriptionId: inscription.id,
        etat: "PRESENT",
      },
    });

    await desinscrireDeTout(c.agents[0], "Test", "départ");

    const presence = await prisma.presence.findFirst({ where: { userId: c.agents[0] } });
    assert.ok(presence, "la présence constatée ne doit pas disparaître");
    assert.equal(presence?.etat, "PRESENT");
    assert.equal(
      presence?.inscriptionId,
      inscription.id,
      "son rattachement à l'inscription doit tenir : les statistiques en dépendent",
    );
  });

  it("nettoie les séances à venir où l'agent était attendu, garde les passées", async () => {
    const c = await contexte({ capacite: 2, agents: 1 });
    const passee = await prisma.seance.create({
      data: { creneauId: c.creneauId, date: new Date("2026-01-05T00:00:00Z") },
    });
    const future = await prisma.seance.create({
      data: {
        creneauId: c.creneauId,
        date: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });
    await prisma.participationPonctuelle.createMany({
      data: [
        { seanceId: passee.id, userId: c.agents[0] },
        { seanceId: future.id, userId: c.agents[0] },
      ],
    });

    await desinscrireDeTout(c.agents[0], "Test", "départ");

    const restantes = await prisma.participationPonctuelle.findMany({
      where: { userId: c.agents[0] },
      select: { seanceId: true },
    });
    assert.deepEqual(
      restantes.map((r) => r.seanceId),
      [passee.id],
      "l'agent ne doit plus être attendu demain, mais reste dans l'historique",
    );
  });

  it("ne touche pas aux inscriptions déjà closes", async () => {
    const c = await contexte({ capacite: 2, agents: 1 });
    await demanderInscription(c.agents[0], c.creneauId);
    await prisma.inscription.updateMany({
      where: { userId: c.agents[0] },
      data: { statut: "REFUSEE", motif: "hors critères" },
    });

    const res = await desinscrireDeTout(c.agents[0], "Test", "départ");

    assert.equal(res.inscriptionsRetirees, 0);
    const i = await prisma.inscription.findFirst({ where: { userId: c.agents[0] } });
    assert.equal(i?.statut, "REFUSEE", "un refus ne devient pas un désistement");
    assert.equal(i?.motif, "hors critères");
  });
});

describe("desactiverCompte", () => {
  it("ferme l'accès et retire les activités quand on le demande", async () => {
    const c = await contexte({ capacite: 2, agents: 1 });
    await demanderInscription(c.agents[0], c.creneauId);
    assert.equal(await compterInscriptionsVivantes(c.agents[0]), 1);

    const res = await desactiverCompte(c.agents[0], {
      acteur: "Test",
      desinscrire: true,
      motif: "départ de la collectivité",
    });

    assert.equal(res.applique, true);
    assert.equal(res.inscriptionsRetirees, 1);
    const u = await prisma.user.findUnique({ where: { id: c.agents[0] } });
    assert.equal(u?.active, false);
    assert.equal(await compterInscriptionsVivantes(c.agents[0]), 0);
  });

  it("garde la place quand on ne demande pas le retrait", async () => {
    // Congé longue durée : l'agent revient, et doit retrouver son créneau.
    const c = await contexte({ capacite: 2, agents: 1 });
    await demanderInscription(c.agents[0], c.creneauId);

    const res = await desactiverCompte(c.agents[0], {
      acteur: "Test",
      desinscrire: false,
      motif: "congé longue durée",
    });

    assert.equal(res.inscriptionsRetirees, 0);
    const u = await prisma.user.findUnique({ where: { id: c.agents[0] } });
    assert.equal(u?.active, false);
    assert.equal(
      await compterInscriptionsVivantes(c.agents[0]),
      1,
      "sa place doit l'attendre",
    );
  });

  it("journalise le départ", async () => {
    const c = await contexte({ capacite: 2, agents: 1 });
    await demanderInscription(c.agents[0], c.creneauId);
    await desactiverCompte(c.agents[0], {
      acteur: "Synchronisation",
      desinscrire: true,
      motif: "compte absent de l'annuaire",
    });

    const ligne = await prisma.auditLog.findFirst({ where: { action: "COMPTE_DESACTIVE" } });
    assert.ok(ligne, "un départ doit laisser une trace");
    assert.equal(ligne?.acteur, "Synchronisation");
    assert.match(ligne?.details ?? "", /compte absent de l'annuaire/);
    assert.match(ligne?.details ?? "", /1 inscription/);
  });

  it("reste sans effet sur un compte inconnu", async () => {
    const res = await desactiverCompte("cuid-qui-n-existe-pas", {
      acteur: "Test",
      desinscrire: true,
      motif: "départ",
    });
    assert.equal(res.applique, false);
  });
});
