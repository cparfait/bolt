import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { reprendreCreneaux } from "../../src/lib/saison";

/**
 * Reprise de la grille d'une saison sur la suivante.
 *
 * Ce qui se vérifie ici n'est pas tant ce qui est recopié que ce qui ne l'est
 * pas : une reprise trop zélée réinscrirait des agents de l'an dernier, ou
 * rouvrirait une activité qu'on avait arrêtée. Ces règles portent sur des
 * relations Prisma (N-N des animateurs, cascade des inscriptions) qu'un faux
 * client aurait approximées.
 *
 *   npm run test:integration
 */

const prisma = new PrismaClient();

let compteur = 0;
const cle = () => `${Date.now().toString(36)}${(compteur += 1)}`;

async function saison(nom: string) {
  return prisma.saison.create({
    data: {
      nom: `${nom}-${cle()}`,
      debut: new Date("2026-09-01T00:00:00Z"),
      fin: new Date("2027-06-30T00:00:00Z"),
    },
  });
}

async function activite(actif = true) {
  return prisma.activite.create({ data: { nom: `activite-${cle()}`, actif } });
}

async function animateur(actif = true) {
  return prisma.coach.create({
    data: { nom: `Nom${cle()}`, prenom: "Prénom", actif },
  });
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
  await prisma.fermeture.deleteMany();
  await prisma.activite.deleteMany();
  await prisma.saison.deleteMany();
  await prisma.coach.deleteMany();
  await prisma.user.deleteMany();
});

after(async () => {
  await prisma.$disconnect();
});

describe("reprise des créneaux d'une saison", () => {
  it("recopie la grille et rattache les mêmes animateurs", async () => {
    const source = await saison("2025-2026");
    const cible = await saison("2026-2027");
    const a = await activite();
    const coach = await animateur();
    await prisma.creneau.create({
      data: {
        saisonId: source.id,
        activiteId: a.id,
        jour: "LUNDI",
        heureDebut: "12:15",
        heureFin: "13:15",
        lieu: "Gymnase VASTEL",
        capacite: 15,
        ouvertInscription: false,
        animateurs: { connect: { id: coach.id } },
      },
    });

    const bilan = await reprendreCreneaux(source.id, cible.id);
    assert.deepEqual(bilan, { repris: 1, ecartes: 0 });

    const repris = await prisma.creneau.findMany({
      where: { saisonId: cible.id },
      include: { animateurs: { select: { id: true } } },
    });
    assert.equal(repris.length, 1);
    assert.equal(repris[0].activiteId, a.id);
    assert.equal(repris[0].jour, "LUNDI");
    assert.equal(repris[0].heureDebut, "12:15");
    assert.equal(repris[0].heureFin, "13:15");
    assert.equal(repris[0].lieu, "Gymnase VASTEL");
    assert.equal(repris[0].capacite, 15);
    assert.equal(repris[0].ouvertInscription, false);
    assert.deepEqual(
      repris[0].animateurs.map((x) => x.id),
      [coach.id],
    );

    // La saison source garde les siens : on copie, on ne déplace pas.
    assert.equal(await prisma.creneau.count({ where: { saisonId: source.id } }), 1);
  });

  it("laisse les bornes du créneau vides plutôt que de recopier des dates périmées", async () => {
    const source = await saison("2025-2026");
    const cible = await saison("2026-2027");
    const a = await activite();
    await prisma.creneau.create({
      data: {
        saisonId: source.id,
        activiteId: a.id,
        jour: "MARDI",
        heureDebut: "18:15",
        heureFin: "19:15",
        dateDebut: new Date("2025-11-04T00:00:00Z"),
        dateFin: new Date("2026-03-31T00:00:00Z"),
      },
    });

    await reprendreCreneaux(source.id, cible.id);

    const [repris] = await prisma.creneau.findMany({ where: { saisonId: cible.id } });
    assert.equal(repris.dateDebut, null);
    assert.equal(repris.dateFin, null);
  });

  it("écarte les créneaux d'une activité arrêtée, et les compte", async () => {
    const source = await saison("2025-2026");
    const cible = await saison("2026-2027");
    const vivante = await activite();
    const arretee = await activite(false);
    for (const [act, jour] of [
      [vivante, "LUNDI"],
      [arretee, "MARDI"],
      [arretee, "JEUDI"],
    ] as const) {
      await prisma.creneau.create({
        data: {
          saisonId: source.id,
          activiteId: act.id,
          jour,
          heureDebut: "12:15",
          heureFin: "13:15",
        },
      });
    }

    const bilan = await reprendreCreneaux(source.id, cible.id);
    assert.deepEqual(bilan, { repris: 1, ecartes: 2 });

    const repris = await prisma.creneau.findMany({ where: { saisonId: cible.id } });
    assert.equal(repris.length, 1);
    assert.equal(repris[0].activiteId, vivante.id);
  });

  it("ne rattache pas un animateur désactivé", async () => {
    const source = await saison("2025-2026");
    const cible = await saison("2026-2027");
    const a = await activite();
    const parti = await animateur(false);
    const reste = await animateur();
    await prisma.creneau.create({
      data: {
        saisonId: source.id,
        activiteId: a.id,
        jour: "MERCREDI",
        heureDebut: "20:15",
        heureFin: "21:00",
        animateurs: { connect: [{ id: parti.id }, { id: reste.id }] },
      },
    });

    await reprendreCreneaux(source.id, cible.id);

    const [repris] = await prisma.creneau.findMany({
      where: { saisonId: cible.id },
      include: { animateurs: { select: { id: true } } },
    });
    assert.deepEqual(
      repris.animateurs.map((x) => x.id),
      [reste.id],
    );
  });

  it("ne reprend ni les inscriptions ni les séances de l'année écoulée", async () => {
    const source = await saison("2025-2026");
    const cible = await saison("2026-2027");
    const a = await activite();
    const creneau = await prisma.creneau.create({
      data: {
        saisonId: source.id,
        activiteId: a.id,
        jour: "VENDREDI",
        heureDebut: "12:15",
        heureFin: "13:15",
      },
    });
    const agent = await prisma.user.create({
      data: { login: `agent-${cle()}`, displayName: "Agent" },
    });
    await prisma.inscription.create({
      data: { creneauId: creneau.id, userId: agent.id, statut: "VALIDEE" },
    });
    await prisma.seance.create({
      data: { creneauId: creneau.id, date: new Date("2025-09-05T00:00:00Z") },
    });

    await reprendreCreneaux(source.id, cible.id);

    const [repris] = await prisma.creneau.findMany({
      where: { saisonId: cible.id },
      include: { _count: { select: { inscriptions: true, seances: true } } },
    });
    assert.equal(repris._count.inscriptions, 0);
    assert.equal(repris._count.seances, 0);
  });

  it("ne reprend pas les périodes de fermeture, calées sur une autre année", async () => {
    const source = await saison("2025-2026");
    const cible = await saison("2026-2027");
    await prisma.fermeture.create({
      data: {
        saisonId: source.id,
        libelle: "Vacances de Noël",
        debut: new Date("2025-12-20T00:00:00Z"),
        fin: new Date("2026-01-05T00:00:00Z"),
      },
    });

    await reprendreCreneaux(source.id, cible.id);

    assert.equal(await prisma.fermeture.count({ where: { saisonId: cible.id } }), 0);
  });

  it("ne crée rien quand la saison modèle est vide", async () => {
    const source = await saison("2025-2026");
    const cible = await saison("2026-2027");

    const bilan = await reprendreCreneaux(source.id, cible.id);
    assert.deepEqual(bilan, { repris: 0, ecartes: 0 });
    assert.equal(await prisma.creneau.count({ where: { saisonId: cible.id } }), 0);
  });
});
