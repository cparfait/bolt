import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { appliquerRegroupements } from "../../src/lib/services";
import { inventaireLibelles, rapprocher } from "../../src/lib/rapprochement";
import { exporterParametrage, lireParametrage } from "../../src/lib/parametrage";

/**
 * Le circuit complet des services : le miroir de l'annuaire d'un côté, le
 * référentiel de l'autre, et les regroupements entre les deux.
 *
 *  1. l'annuaire est synchronisé dans un miroir, avec son libellé brut ;
 *  2. le référentiel est une table à part, qui ne contient que les noms
 *     reconnus par la collectivité ;
 *  3. les regroupements font correspondre un libellé d'annuaire à un service
 *     du référentiel, et le service affiché sur un compte en découle ;
 *  4. les libellés de l'annuaire absents du référentiel sont inventoriés —
 *     tout l'annuaire, pas seulement ceux qui ont déjà un compte.
 *
 *   npm run test:integration
 */

const prisma = new PrismaClient();

before(() => {
  assert.ok(
    /bolt_test/.test(process.env.DATABASE_URL ?? ""),
    "DATABASE_URL doit pointer sur bolt_test : ces tests écrivent et effacent.",
  );
});

beforeEach(async () => {
  await prisma.presence.deleteMany();
  await prisma.participationPonctuelle.deleteMany();
  await prisma.inscription.deleteMany();
  await prisma.user.deleteMany();
  await prisma.adAccount.deleteMany();
  await prisma.regroupementService.deleteMany();
  await prisma.service.deleteMany();
});

after(async () => {
  await prisma.$disconnect();
});

const compteAd = (login: string, service: string | null, enabled = true) => ({
  samAccountName: login,
  displayName: login,
  dn: `CN=${login},OU=Utilisateurs,DC=test`,
  ou: "Utilisateurs",
  service,
  enabled,
});

describe("services : annuaire, référentiel et regroupements", () => {
  it("résout le service affiché depuis le libellé brut et les règles, sans toucher au miroir", async () => {
    // 1. Le miroir de l'annuaire, tel que la synchronisation l'écrit.
    await prisma.adAccount.createMany({
      data: [
        compteAd("a.dupont", "Crèche Sablons"),
        compteAd("b.martin", "CTM"),
        compteAd("c.durand", "Sports"),
        compteAd("e.legrand", "Sports"),
      ],
    });
    // Des comptes Bolt, avec ce que la connexion y avait écrit avant.
    await prisma.user.createMany({
      data: [
        { login: "a.dupont", displayName: "A", service: "Crèche Sablons" },
        { login: "b.martin", displayName: "B", service: "CTM" },
        { login: "c.durand", displayName: "C", service: "Sports" },
        // Rattachement décidé à la main : une règle ne le défait pas.
        { login: "e.legrand", displayName: "E", service: "Education", serviceForce: true },
      ],
    });
    // 2. Le référentiel, à part.
    await prisma.service.createMany({
      data: [
        { nom: "Petite Enfance", ordre: 0 },
        { nom: "Centre Technique municipal", ordre: 1 },
        { nom: "Sports", ordre: 2 },
        { nom: "Education", ordre: 3 },
      ],
    });
    // 3. Une règle, avec une graphie différente de l'annuaire.
    await prisma.regroupementService.create({
      data: { source: "Crêche Sablons", cible: "Petite Enfance" },
    });

    await appliquerRegroupements();

    const service = async (login: string) =>
      (await prisma.user.findUniqueOrThrow({ where: { login } })).service;
    assert.equal(await service("a.dupont"), "Petite Enfance", "la règle s'applique");
    assert.equal(await service("b.martin"), "CTM", "sans règle, le libellé brut est conservé");
    assert.equal(await service("c.durand"), "Sports", "un libellé du référentiel se reconnaît seul");
    assert.equal(await service("e.legrand"), "Education", "un rattachement forcé tient");

    // Le miroir garde le libellé brut : c'est lui qui rend le rapprochement rejouable.
    const miroir = await prisma.adAccount.findUniqueOrThrow({ where: { samAccountName: "a.dupont" } });
    assert.equal(miroir.service, "Crèche Sablons");
  });

  it("inventorie les libellés de tout l'annuaire absents du référentiel, règles déduites", async () => {
    await prisma.adAccount.createMany({
      data: [
        compteAd("a.dupont", "Crèche Sablons"),
        compteAd("b.martin", "CTM"),
        compteAd("c.durand", "Sports"),
        // Personne ne s'est encore connecté : doit apparaître quand même.
        compteAd("d.petit", "Police Municipale"),
        compteAd("f.parti", "Ancien service", false),
      ],
    });
    await prisma.user.createMany({
      data: [
        { login: "a.dupont", displayName: "A" },
        { login: "no_ad.camille.martin", displayName: "Camille", service: "Élus" },
      ],
    });
    await prisma.service.createMany({
      data: [
        { nom: "Petite Enfance", ordre: 0 },
        { nom: "Centre Technique municipal", ordre: 1 },
        { nom: "Sports", ordre: 2 },
      ],
    });
    await prisma.regroupementService.create({
      data: { source: "Crèche Sablons", cible: "Petite Enfance" },
    });

    const inventaire = await inventaireLibelles();
    const parLibelle = new Map(inventaire.map((l) => [l.libelle, l]));

    assert.ok(parLibelle.has("CTM"), "libellé sans règle");
    assert.ok(parLibelle.has("Police Municipale"), "compte d'annuaire sans compte Bolt");
    assert.ok(parLibelle.has("Élus"), "participant hors annuaire");
    assert.equal(parLibelle.get("Élus")?.horsAnnuaire, 1);
    assert.ok(!parLibelle.has("Crèche Sablons"), "couvert par une règle");
    assert.ok(!parLibelle.has("Sports"), "déjà au référentiel");
    assert.ok(!parLibelle.has("Ancien service"), "compte désactivé dans l'annuaire");

    // 4. Le moteur propose la cible, et la règle posée fait disparaître le libellé.
    const [ctm] = rapprocher([parLibelle.get("CTM")!], ["Petite Enfance", "Centre Technique municipal", "Sports"]);
    assert.equal(ctm.proposition, "Centre Technique municipal");

    await prisma.regroupementService.create({
      data: { source: "CTM", cible: "Centre Technique municipal" },
    });
    const apres = await inventaireLibelles();
    assert.ok(!apres.some((l) => l.libelle === "CTM"));
  });

  it("exporte un paramétrage que la lecture accepte tel quel", async () => {
    await prisma.service.createMany({
      data: [
        { nom: "Petite Enfance", ordre: 0 },
        { nom: "Sports", ordre: 1, actif: false },
      ],
    });
    await prisma.regroupementService.create({
      data: { source: "Crèche Sablons", cible: "Petite Enfance" },
    });

    const exporte = await exporterParametrage();
    const relu = lireParametrage(JSON.stringify(exporte));
    assert.deepEqual(relu.referentiel, [
      { nom: "Petite Enfance", actif: true },
      { nom: "Sports", actif: false },
    ]);
    assert.deepEqual(relu.regroupements, [{ source: "Crèche Sablons", cible: "Petite Enfance" }]);
    assert.deepEqual(relu.exclusionsSync, []);
    assert.deepEqual(relu.agents, []);
  });
});
