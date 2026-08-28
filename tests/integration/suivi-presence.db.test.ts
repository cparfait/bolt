import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { indicateurs, parActivite } from "../../src/lib/stats";
import { feuillesAttendues } from "../../src/lib/emargement";

/**
 * Activités pratiquées en autonomie.
 *
 * Une salle en libre accès n'a personne pour pointer. Sans le drapeau
 * `suiviPresence`, ses séances passées comptaient comme des feuilles jamais
 * transmises : le taux d'émargement de la collectivité s'effondrait, l'alerte
 * du tableau de bord réclamait indéfiniment une feuille qui n'arriverait
 * jamais, et l'activité sortait du bilan QVT à 0 % de présence — soit
 * l'inverse de la vérité, puisqu'elle peut être la plus courue.
 *
 * Ces vérifications passent par une vraie base : ce qui se joue est le
 * dénominateur d'un indicateur qui circule en comité social.
 */

const SAISON = "test-suivi-saison";
const AVEC = "test-suivi-avec";
const SANS = "test-suivi-sans";

async function nettoyer() {
  await prisma.presence.deleteMany({ where: { seance: { creneau: { saisonId: SAISON } } } });
  await prisma.inscription.deleteMany({ where: { creneau: { saisonId: SAISON } } });
  await prisma.seance.deleteMany({ where: { creneau: { saisonId: SAISON } } });
  await prisma.creneau.deleteMany({ where: { saisonId: SAISON } });
  await prisma.saison.deleteMany({ where: { id: SAISON } });
  await prisma.activite.deleteMany({ where: { id: { in: [AVEC, SANS] } } });
}

describe("activités sans émargement", () => {
  before(async () => {
    await nettoyer();
    const hier = new Date();
    hier.setDate(hier.getDate() - 1);

    await prisma.saison.create({
      data: {
        id: SAISON,
        nom: "Test suivi de présence",
        debut: new Date("2020-01-01"),
        fin: new Date("2030-12-31"),
        active: false,
      },
    });

    for (const [id, nom, suiviPresence] of [
      [AVEC, "Test yoga émargé", true],
      [SANS, "Test musculation libre", false],
    ] as const) {
      await prisma.activite.create({ data: { id, nom, suiviPresence } });
      await prisma.creneau.create({
        data: {
          id: `${id}-creneau`,
          saisonId: SAISON,
          activiteId: id,
          jour: "LUNDI",
          heureDebut: "12:30",
          heureFin: "13:30",
          capacite: 10,
        },
      });
      // Une séance passée, non émargée, dans les deux cas.
      await prisma.seance.create({
        data: { id: `${id}-seance`, creneauId: `${id}-creneau`, date: hier },
      });
    }
  });

  after(nettoyer);

  it("exclut du taux d'émargement les séances qui n'avaient pas à l'être", async () => {
    const ind = await indicateurs({ saisonId: SAISON });
    // Deux séances passées, aucune émargée. Seule celle de l'activité pointée
    // compte au dénominateur — sinon le taux resterait à 0 % quoi que fasse
    // le service des sports.
    assert.equal(ind.seancesTotal, 2);
    assert.equal(ind.seancesPassees, 1);
    assert.equal(ind.seancesSansEmargement, 1);
    assert.equal(ind.tauxEmargement, 0);
  });

  it("n'attend aucune feuille sur une activité en autonomie", async () => {
    await prisma.user.upsert({
      where: { login: "test-suivi-agent" },
      update: {},
      create: { login: "test-suivi-agent", displayName: "Agent de test" },
    });
    const agent = await prisma.user.findUniqueOrThrow({ where: { login: "test-suivi-agent" } });
    for (const id of [AVEC, SANS]) {
      await prisma.inscription.create({
        data: {
          creneauId: `${id}-creneau`,
          userId: agent.id,
          statut: "VALIDEE",
          demandeAt: new Date("2020-01-01"),
          decisionAt: new Date("2020-01-01"),
        },
      });
    }

    const seances = await prisma.seance.findMany({
      where: { creneau: { saisonId: SAISON } },
      select: { id: true, date: true, creneauId: true },
    });
    const attendues = await feuillesAttendues(seances);

    assert.deepEqual(
      attendues.map((s) => s.id),
      [`${AVEC}-seance`],
      "seule l'activité émargée doit figurer parmi les feuilles attendues",
    );
  });

  it("porte l'information jusqu'au tableau du bilan", async () => {
    const lignes = await parActivite({ saisonId: SAISON });
    const sans = lignes.find((l) => l.activiteId === SANS);
    // L'affichage remplace alors les taux par un tiret : un « 0 % » se lirait
    // comme un échec de fréquentation.
    assert.equal(sans?.suiviPresence, false);
    assert.equal(lignes.find((l) => l.activiteId === AVEC)?.suiviPresence, true);
  });
});
