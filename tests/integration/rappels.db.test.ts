import assert from "node:assert/strict";
import net from "node:net";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { envoyerRappels } from "../../src/lib/rappels";
import { setSetting } from "../../src/lib/settings";

/**
 * Campagne de rappels face à une messagerie qui ne suit pas.
 *
 * Le défaut corrigé ici ne se voyait nulle part : la séance se marquait
 * « rappelée » à la fin de la boucle, que les messages soient partis ou non.
 * Microsoft 365 refusant tout au-delà de trente soumissions par minute, les
 * inscrits au-delà de ce cap ne recevaient jamais rien — et rien ne le disait.
 *
 * Une messagerie factice, minimale, joue les trois réponses qui comptent :
 * accepter, refuser une adresse pour elle-même, refuser de servir tout court.
 *
 *   npm run test:integration
 */

const SAISON = "test-rappels-saison";
const ACTIVITE = "test-rappels-activite";

/** Un serveur SMTP de quelques lignes, piloté par un scénario sur RCPT TO. */
function messagerieFactice(reponse: (adresse: string) => string) {
  const recus: string[] = [];
  const serveur = net.createServer((socket) => {
    socket.write("220 factice\r\n");
    let enveloppe = "";
    let donnees = false;
    socket.on("data", (buf) => {
      for (const ligne of buf.toString().split("\r\n")) {
        if (!ligne) continue;
        if (donnees) {
          if (ligne === ".") {
            donnees = false;
            recus.push(enveloppe);
            socket.write("250 ok\r\n");
          }
          continue;
        }
        const cmd = ligne.split(" ")[0].toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") socket.write("250-factice\r\n250 8BITMIME\r\n");
        else if (cmd === "MAIL") socket.write("250 ok\r\n");
        else if (cmd === "RCPT") {
          enveloppe = ligne.replace(/^RCPT TO:<(.*)>.*$/i, "$1");
          socket.write(reponse(enveloppe) + "\r\n");
        } else if (cmd === "DATA") {
          donnees = true;
          socket.write("354 go\r\n");
        } else if (cmd === "QUIT") {
          socket.end("221 bye\r\n");
        } else socket.write("250 ok\r\n");
      }
    });
  });
  return {
    recus,
    demarrer: () =>
      new Promise<number>((ok) =>
        serveur.listen(0, "127.0.0.1", () => ok((serveur.address() as net.AddressInfo).port)),
      ),
    arreter: () => new Promise<void>((ok) => serveur.close(() => ok())),
  };
}

async function nettoyer() {
  await prisma.rappelEnvoye.deleteMany({ where: { seance: { creneau: { saisonId: SAISON } } } });
  await prisma.inscription.deleteMany({ where: { creneau: { saisonId: SAISON } } });
  await prisma.seance.deleteMany({ where: { creneau: { saisonId: SAISON } } });
  await prisma.creneau.deleteMany({ where: { saisonId: SAISON } });
  await prisma.saison.deleteMany({ where: { id: SAISON } });
  await prisma.activite.deleteMany({ where: { id: ACTIVITE } });
  await prisma.user.deleteMany({ where: { login: { startsWith: "test-rappels-" } } });
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: "RAPPELS_" } } });
}

/** Une séance demain, `n` inscrits joignables. */
async function contexte(n: number) {
  const demain = new Date();
  demain.setUTCDate(demain.getUTCDate() + 1);
  const jour = new Date(
    Date.UTC(demain.getUTCFullYear(), demain.getUTCMonth(), demain.getUTCDate()),
  );

  await prisma.saison.create({
    data: { id: SAISON, nom: `rappels-${Date.now()}`, debut: jour, fin: jour, active: false },
  });
  await prisma.activite.create({ data: { id: ACTIVITE, nom: `rappels-${Date.now()}` } });
  const creneau = await prisma.creneau.create({
    data: {
      saisonId: SAISON,
      activiteId: ACTIVITE,
      jour: "LUNDI",
      heureDebut: "12:15",
      heureFin: "13:15",
      capacite: 50,
    },
  });
  const seance = await prisma.seance.create({ data: { creneauId: creneau.id, date: jour } });
  for (let k = 1; k <= n; k++) {
    const u = await prisma.user.create({
      data: { login: `test-rappels-${k}`, displayName: `Agent ${k}`, email: `agent${k}@exemple.fr` },
    });
    await prisma.inscription.create({
      data: { creneauId: creneau.id, userId: u.id, statut: "VALIDEE" },
    });
  }
  return seance;
}

const reglages = async (port: number | null) => {
  // Rappels dus dès minuit, deux jours d'avance : la séance de demain est
  // toujours dans la fenêtre, quelle que soit l'heure du test.
  await setSetting("general", {
    rappelsActifs: true,
    rappelJoursAvant: 2,
    rappelHeure: "00:00",
    appUrl: "https://exemple.test",
  });
  await setSetting(
    "smtp",
    port ? { host: "127.0.0.1", port, secure: false, from: "bolt@exemple.fr" } : null,
  );
};

const lignes = (seanceId: string) =>
  prisma.rappelEnvoye.findMany({ where: { seanceId }, orderBy: { userId: "asc" } });

describe("campagne de rappels", () => {
  beforeEach(nettoyer);
  afterEach(() => setSetting("smtp", null));
  after(async () => {
    await nettoyer();
    await prisma.$disconnect();
  });

  it("n'inscrit rien et ne marque pas la séance quand la messagerie refuse de servir", async () => {
    const seance = await contexte(3);
    await reglages(null); // messagerie non configurée

    const res = await envoyerRappels();

    assert.equal(res.envoyes, 0);
    assert.ok(res.interrompu, "la campagne devait se déclarer interrompue");
    assert.equal((await lignes(seance.id)).length, 0);
    const s = await prisma.seance.findUniqueOrThrow({ where: { id: seance.id } });
    assert.equal(s.rappelEnvoyeAt, null, "avant, la séance était marquée rappelée malgré l'échec");
  });

  it("reprend au passage suivant exactement là où la messagerie s'est fermée", async () => {
    const seance = await contexte(5);
    // Le serveur accepte deux messages puis plafonne, comme Microsoft 365 au
    // trente-et-unième — ici au troisième, pour un test court.
    let acceptes = 0;
    const factice = messagerieFactice(() =>
      acceptes++ < 2
        ? "250 ok"
        : "451 4.4.2 Message submission rate for this client has exceeded the configured limit",
    );
    const port = await factice.demarrer();
    try {
      await reglages(port);

      const premier = await envoyerRappels();
      assert.equal(premier.envoyes, 2);
      assert.ok(premier.interrompu?.includes("4.4.2"));
      assert.equal(premier.seances, 0, "séance inachevée : pas marquée");
      assert.equal((await lignes(seance.id)).length, 2);

      // Le plafond se lève ; le battement suivant ne renvoie pas aux deux premiers.
      acceptes = -1000;
      const second = await envoyerRappels();
      assert.equal(second.envoyes, 3);
      assert.equal(second.interrompu, undefined);
      assert.equal(second.seances, 1);

      assert.equal(factice.recus.length, 5, "chaque inscrit reçoit exactement un message");
      assert.equal(new Set(factice.recus).size, 5);
      const s = await prisma.seance.findUniqueOrThrow({ where: { id: seance.id } });
      assert.ok(s.rappelEnvoyeAt);

      // Un troisième passage n'a plus rien à faire.
      assert.equal((await envoyerRappels()).envoyes, 0);
      assert.equal(factice.recus.length, 5);
    } finally {
      await factice.arreter();
    }
  });

  it("écarte une adresse refusée pour elle-même sans arrêter la campagne", async () => {
    const seance = await contexte(3);
    const factice = messagerieFactice((adresse) =>
      adresse === "agent2@exemple.fr" ? "550 5.1.1 User unknown" : "250 ok",
    );
    const port = await factice.demarrer();
    try {
      await reglages(port);
      const res = await envoyerRappels();

      assert.equal(res.envoyes, 2);
      assert.equal(res.refuses, 1);
      assert.equal(res.seances, 1);
      const l = await lignes(seance.id);
      assert.equal(l.length, 3, "l'adresse refusée a sa ligne, elle ne sera pas retentée");
      assert.equal(l.filter((r) => r.erreur).length, 1);
      assert.ok(l.find((r) => r.erreur)!.erreur!.includes("5.1.1"));
    } finally {
      await factice.arreter();
    }
  });
});
