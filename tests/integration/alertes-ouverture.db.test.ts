import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { basculerAlerte, notifierOuverture } from "../../src/lib/alertes-ouverture";
import { setSetting } from "../../src/lib/settings";

/**
 * Alertes d'ouverture : « prévenez-moi quand ce créneau rouvre ».
 *
 * Sur une vraie base, parce que la règle tient à une contrainte d'unicité et
 * à un effacement conditionnel : l'alerte part quand le courriel est parti,
 * reste quand il n'a pas pu.
 */

const prisma = new PrismaClient();
let compteur = 0;
const cle = () => `${Date.now().toString(36)}${(compteur += 1)}`;

async function contexte() {
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
      capacite: 10,
      ouvertInscription: false,
    },
  });
  const agent = await prisma.user.create({
    data: { login: `agent-${cle()}`, displayName: "Agent Test", email: "agent@test.local" },
  });
  return { creneau, agent };
}

before(async () => {
  assert.ok(
    /bolt_test/.test(process.env.DATABASE_URL ?? ""),
    "DATABASE_URL doit pointer sur bolt_test : ces tests écrivent et effacent.",
  );
});

beforeEach(async () => {
  await prisma.alerteOuverture.deleteMany();
  await prisma.inscription.deleteMany();
  await prisma.seance.deleteMany();
  await prisma.creneau.deleteMany();
  await prisma.activite.deleteMany();
  await prisma.saison.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  // Pas de messagerie configurée : aucun courriel ne peut partir.
  await setSetting("smtp", null);
});

after(async () => {
  await prisma.$disconnect();
});

describe("alerte d'ouverture", () => {
  it("se pose une fois, et se retire au second geste", async () => {
    const { creneau, agent } = await contexte();
    assert.deepEqual(await basculerAlerte(agent.id, creneau.id), { posee: true });
    assert.equal(await prisma.alerteOuverture.count(), 1);
    assert.deepEqual(await basculerAlerte(agent.id, creneau.id), { posee: false });
    assert.equal(await prisma.alerteOuverture.count(), 0);
  });

  it("reste en place tant que le courriel n'est pas parti", async () => {
    const { creneau, agent } = await contexte();
    await basculerAlerte(agent.id, creneau.id);
    const res = await notifierOuverture(creneau.id);
    assert.equal(res.destinataires, 1);
    assert.equal(res.envoyes, 0, "sans messagerie, rien ne part");
    assert.equal(await prisma.alerteOuverture.count(), 1, "l'alerte attend la prochaine ouverture");
  });

  it("s'efface pour un compte sans adresse : elle ne servira jamais", async () => {
    const { creneau, agent } = await contexte();
    await prisma.user.update({ where: { id: agent.id }, data: { email: null } });
    await basculerAlerte(agent.id, creneau.id);
    const res = await notifierOuverture(creneau.id);
    assert.equal(res.destinataires, 1);
    assert.equal(await prisma.alerteOuverture.count(), 0);
  });

  it("ne fait rien sur un créneau sans alerte", async () => {
    const { creneau } = await contexte();
    assert.deepEqual(await notifierOuverture(creneau.id), { destinataires: 0, envoyes: 0 });
  });
});
