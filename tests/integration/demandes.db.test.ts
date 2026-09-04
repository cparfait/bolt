import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { deposerDemande, refuserDemande, validerDemande } from "../../src/lib/demandes";
import { estHorsAnnuaire } from "../../src/lib/comptes";
import { setSetting } from "../../src/lib/settings";

/**
 * Demandes d'accès déposées depuis Internet.
 *
 * Le formulaire de `/demande-acces` est le seul chemin publié qui accepte une
 * identité que Bolt ne connaît pas. Tout ce qui le rend acceptable tient à des
 * propriétés qu'on ne lit pas dans le code : elles se vérifient ici.
 *
 *   npm run test:integration
 */

const prisma = new PrismaClient();

let compteur = 0;
const adresse = () => `demande-${Date.now().toString(36)}${(compteur += 1)}@exemple.fr`;

beforeEach(async () => {
  // Sans SMTP configuré, `envoyerMail` est inerte : les tests portent sur les
  // effets en base, pas sur l'envoi.
  await setSetting("smtp", null);
  await setSetting("general", { contactEmail: "", appUrl: "https://exemple.test" });
});

after(async () => {
  await prisma.$disconnect();
});

const gestionnaire = { id: "test-gestionnaire", displayName: "Service des sports" };

describe("dépôt d'une demande", () => {
  it("enregistre la demande sans créer ni compte ni droit", async () => {
    const email = adresse();
    assert.equal(await deposerDemande({ nom: "Camille Martin", email }), "enregistree");

    const demande = await prisma.demandeAcces.findFirst({ where: { email } });
    assert.ok(demande, "la demande devait être enregistrée");
    assert.equal(demande.statut, "EN_ATTENTE");

    // Le point capital : une demande n'est PAS une identité.
    const compte = await prisma.user.findFirst({ where: { email } });
    assert.equal(compte, null, "aucun compte ne doit exister avant validation");
  });

  it("n'empile pas deux demandes pour la même adresse", async () => {
    const email = adresse();
    await deposerDemande({ nom: "Camille Martin", email });
    assert.equal(await deposerDemande({ nom: "Camille Martin", email }), "deja");
    assert.equal(await prisma.demandeAcces.count({ where: { email } }), 1);
  });

  it("ignore silencieusement une adresse déjà titulaire d'un compte", async () => {
    // Répondre autre chose ferait de ce formulaire un moyen de vérifier, depuis
    // Internet, qui travaille dans la collectivité. La distinction existe pour
    // le serveur, jamais pour le visiteur : l'appelant renvoie le même message.
    const email = adresse();
    await prisma.user.create({
      data: { login: `no_ad.connu.${compteur}`, displayName: "Déjà connu", email },
    });

    assert.equal(await deposerDemande({ nom: "Déjà connu", email }), "ignoree");
    assert.equal(await prisma.demandeAcces.count({ where: { email } }), 0);
  });

  it("reconnaît aussi l'adresse de contact, pas seulement celle de l'annuaire", async () => {
    const email = adresse();
    await prisma.user.create({
      data: {
        login: `no_ad.terrain.${compteur}`,
        displayName: "Agent de terrain",
        email: adresse(),
        emailContact: email, // celle que l'agent connaît, et qu'il saisirait
      },
    });
    assert.equal(await deposerDemande({ nom: "Agent de terrain", email }), "ignoree");
  });
});

describe("validation par le service des sports", () => {
  it("crée un compte hors annuaire, et lui seul ouvre l'accès", async () => {
    const email = adresse();
    await deposerDemande({ nom: "Camille Martin", email });
    const demande = await prisma.demandeAcces.findFirstOrThrow({ where: { email } });

    const res = await validerDemande(demande.id, gestionnaire);
    assert.equal(res.ok, true);

    const compte = await prisma.user.findFirstOrThrow({ where: { email } });
    // Le préfixe n'est pas cosmétique : il garantit l'absence de collision avec
    // un sAMAccountName, et il exclut ce compte de la désactivation
    // automatique que la synchronisation applique aux absents de l'annuaire.
    assert.equal(estHorsAnnuaire(compte.login), true);
    assert.equal(compte.role, "AGENT");
    assert.equal(compte.isLocal, false, "aucun mot de passe : le lien e-mail est la seule porte");

    const apres = await prisma.demandeAcces.findFirstOrThrow({ where: { id: demande.id } });
    assert.equal(apres.statut, "VALIDEE");
    assert.equal(apres.userId, compte.id);
    assert.equal(apres.decidePar, gestionnaire.displayName);
  });

  it("ne fabrique pas de doublon si la personne a obtenu un compte entre-temps", async () => {
    const email = adresse();
    await deposerDemande({ nom: "Camille Martin", email });
    const demande = await prisma.demandeAcces.findFirstOrThrow({ where: { email } });

    // Le service a créé le compte à la main, ou la personne a obtenu un compte
    // AD, pendant que la demande dormait dans la file.
    const existant = await prisma.user.create({
      data: { login: `no_ad.entre-temps.${compteur}`, displayName: "Camille Martin", email },
    });

    const res = await validerDemande(demande.id, gestionnaire);
    assert.equal(res.ok, true);
    assert.equal(await prisma.user.count({ where: { email } }), 1);

    const apres = await prisma.demandeAcces.findFirstOrThrow({ where: { id: demande.id } });
    assert.equal(apres.userId, existant.id);
  });

  it("refuse de traiter deux fois la même demande", async () => {
    const email = adresse();
    await deposerDemande({ nom: "Camille Martin", email });
    const demande = await prisma.demandeAcces.findFirstOrThrow({ where: { email } });

    await validerDemande(demande.id, gestionnaire);
    const rejeu = await validerDemande(demande.id, gestionnaire);
    assert.equal(rejeu.ok, false);
    assert.equal(await prisma.user.count({ where: { email } }), 1);
  });
});

describe("refus", () => {
  it("classe la demande sans créer de compte, et garde le motif", async () => {
    const email = adresse();
    await deposerDemande({ nom: "Inconnu au bataillon", email });
    const demande = await prisma.demandeAcces.findFirstOrThrow({ where: { email } });

    const res = await refuserDemande(demande.id, "Sans lien avec la collectivité", gestionnaire);
    assert.equal(res.ok, true);

    const apres = await prisma.demandeAcces.findFirstOrThrow({ where: { id: demande.id } });
    assert.equal(apres.statut, "REFUSEE");
    assert.equal(apres.motif, "Sans lien avec la collectivité");
    assert.equal(await prisma.user.count({ where: { email } }), 0);
  });

  it("laisse redéposer une demande après un refus", async () => {
    // Un refus ne doit pas bannir définitivement une adresse : la situation
    // change — le vacataire de septembre est titulaire en janvier.
    const email = adresse();
    await deposerDemande({ nom: "Camille Martin", email });
    const demande = await prisma.demandeAcces.findFirstOrThrow({ where: { email } });
    await refuserDemande(demande.id, "Trop tôt", gestionnaire);

    assert.equal(await deposerDemande({ nom: "Camille Martin", email }), "enregistree");
  });
});
