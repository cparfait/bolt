import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { enregistrerPresence, reprendreAbsencesAnnoncees } from "../../src/lib/emargement";

/**
 * Reprise des absences annoncées au moment de clore la feuille.
 *
 * Une absence annoncée ne crée pas de présence : la poser à l'avance ferait
 * basculer la séance en « émargée » des semaines avant qu'elle ait lieu. Mais
 * si personne ne la reprend à la clôture, l'agent qui prévient disparaît du
 * bilan — ni présent, ni absent —, tandis que celui qui ne dit rien est pointé
 * absent. Prévenir revenait à se faire oublier des statistiques.
 *
 * Ce qui se vérifie ici est donc un dénominateur, et il se joue sur une vraie
 * base : contraintes d'unicité, upsert, et bascule du statut de la séance.
 */

const SAISON = "test-abs-saison";
const ACTIVITE = "test-abs-activite";

async function nettoyer() {
  await prisma.presence.deleteMany({ where: { seance: { creneau: { saisonId: SAISON } } } });
  await prisma.absenceAnnoncee.deleteMany({
    where: { seance: { creneau: { saisonId: SAISON } } },
  });
  await prisma.inscription.deleteMany({ where: { creneau: { saisonId: SAISON } } });
  await prisma.seance.deleteMany({ where: { creneau: { saisonId: SAISON } } });
  await prisma.creneau.deleteMany({ where: { saisonId: SAISON } });
  await prisma.saison.deleteMany({ where: { id: SAISON } });
  await prisma.activite.deleteMany({ where: { id: ACTIVITE } });
  await prisma.user.deleteMany({ where: { login: { startsWith: "test-abs-" } } });
}

/** Une séance d'hier, trois inscrits. */
async function contexte() {
  const hier = new Date();
  hier.setDate(hier.getDate() - 1);
  const jour = new Date(
    Date.UTC(hier.getUTCFullYear(), hier.getUTCMonth(), hier.getUTCDate()),
  );

  await prisma.saison.create({
    data: {
      id: SAISON,
      nom: `abs-${Date.now()}`,
      debut: jour,
      fin: jour,
      active: false,
    },
  });
  await prisma.activite.create({ data: { id: ACTIVITE, nom: `abs-${Date.now()}` } });
  const creneau = await prisma.creneau.create({
    data: {
      saisonId: SAISON,
      activiteId: ACTIVITE,
      jour: "LUNDI",
      heureDebut: "12:15",
      heureFin: "13:15",
      capacite: 10,
    },
  });
  const seance = await prisma.seance.create({ data: { creneauId: creneau.id, date: jour } });

  const agents = [];
  for (const suffixe of ["prevenu", "pointe", "muet"]) {
    const u = await prisma.user.create({
      data: { login: `test-abs-${suffixe}`, displayName: suffixe },
    });
    await prisma.inscription.create({
      data: { creneauId: creneau.id, userId: u.id, statut: "VALIDEE" },
    });
    agents.push(u);
  }
  return { seance, agents: { prevenu: agents[0], pointe: agents[1], muet: agents[2] } };
}

describe("absences annoncées reprises à la clôture", () => {
  beforeEach(nettoyer);
  after(async () => {
    await nettoyer();
    await prisma.$disconnect();
  });

  it("porte l'absence de celui qui a prévenu et n'a pas été pointé", async () => {
    const { seance, agents } = await contexte();
    await prisma.absenceAnnoncee.create({
      data: { seanceId: seance.id, userId: agents.prevenu.id, motif: "congés" },
    });

    const reprises = await reprendreAbsencesAnnoncees(seance.id, "absence annoncée");

    assert.equal(reprises, 1);
    const ligne = await prisma.presence.findUnique({
      where: { seanceId_userId: { seanceId: seance.id, userId: agents.prevenu.id } },
    });
    assert.equal(ligne?.etat, "ABSENT");
    assert.equal(ligne?.saisiPar, "absence annoncée");
    // La ligne est rattachée à l'inscription : sans cela, l'absence ne compte
    // pas dans l'assiduité de l'agent sur ce créneau.
    assert.ok(ligne?.inscriptionId, "la présence doit désigner l'inscription");
  });

  it("ne touche pas à ce que l'animateur a pointé lui-même", async () => {
    const { seance, agents } = await contexte();
    await prisma.absenceAnnoncee.create({
      data: { seanceId: seance.id, userId: agents.pointe.id },
    });
    // Il avait prévenu, puis il est venu quand même : le constat de
    // l'animateur prime sur l'intention de l'agent.
    await enregistrerPresence(seance.id, agents.pointe.id, "PRESENT", "coach:x");

    const reprises = await reprendreAbsencesAnnoncees(seance.id, "absence annoncée");

    assert.equal(reprises, 0);
    const ligne = await prisma.presence.findUnique({
      where: { seanceId_userId: { seanceId: seance.id, userId: agents.pointe.id } },
    });
    assert.equal(ligne?.etat, "PRESENT");
    assert.equal(ligne?.saisiPar, "coach:x");
  });

  it("laisse sans ligne l'inscrit qui n'a ni prévenu ni été pointé", async () => {
    const { seance, agents } = await contexte();
    await prisma.absenceAnnoncee.create({
      data: { seanceId: seance.id, userId: agents.prevenu.id },
    });

    await reprendreAbsencesAnnoncees(seance.id, "absence annoncée");

    // On ne sait pas ce qu'il a fait : lui inventer une absence serait un
    // constat que personne n'a établi.
    const ligne = await prisma.presence.findUnique({
      where: { seanceId_userId: { seanceId: seance.id, userId: agents.muet.id } },
    });
    assert.equal(ligne, null);
  });

  it("se rejoue sans créer de doublon", async () => {
    const { seance, agents } = await contexte();
    await prisma.absenceAnnoncee.create({
      data: { seanceId: seance.id, userId: agents.prevenu.id },
    });

    await reprendreAbsencesAnnoncees(seance.id, "absence annoncée");
    const seconde = await reprendreAbsencesAnnoncees(seance.id, "absence annoncée");

    assert.equal(seconde, 0, "la seconde passe n'a plus rien à reprendre");
    assert.equal(await prisma.presence.count({ where: { seanceId: seance.id } }), 1);
  });
});
