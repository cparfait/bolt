/**
 * Jeu de démonstration en ligne de commande.
 *
 *   npm run db:seed
 *
 * Ne contient plus que ce qui est propre à une base neuve — le compte
 * administrateur, celui du service des sports, un paramétrage de départ. Tout
 * le reste vient de `chargerJeuDeTest` (src/lib/jeu-de-test.ts), le même
 * générateur que le bouton de Paramètres → Remise à zéro : une démonstration
 * qui diverge de ce que l'application sait produire d'elle-même finit par
 * montrer des écrans qui n'existent plus.
 *
 * Idempotent : relançable sans créer de doublon.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { chargerJeuDeTest } from "../src/lib/jeu-de-test";

const prisma = new PrismaClient();

// Mot de passe fixe, contrairement au chargement depuis l'application : le seed
// s'exécute dans un terminal de développement, sur une base jetable, et un
// identifiant qu'on retrouve dans le README vaut mieux qu'un tirage à noter.
const MOT_DE_PASSE = "bolt";

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
      passwordHash: await bcrypt.hash(process.env.BOLT_ADMIN_PASSWORD || MOT_DE_PASSE, 12),
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
      passwordHash: await bcrypt.hash(MOT_DE_PASSE, 12),
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
        maxInscriptionsParAgent: 1,
        maxListeAttenteParAgent: 1,
        validationRequise: true,
        absencesAvantRelance: 3,
        lienMagiqueActif: false,
      }),
    },
  });

  // ── Exploitation ───────────────────────────────────────────────────────
  const jeu = await chargerJeuDeTest({ motDePasse: MOT_DE_PASSE });

  console.log(`  saison ${jeu.saison}, ${jeu.seances} séances planifiées`);
  console.log(
    `  ${jeu.agents} agents, ${jeu.creneaux} créneaux, ${jeu.inscriptions} inscriptions, ${jeu.presences} pointages`,
  );
  console.log("");
  console.log(`  Comptes de démonstration (mot de passe : ${MOT_DE_PASSE})`);
  console.log("    admin    — administrateur (DSI)");
  console.log("    sports   — service des sports");
  for (const c of jeu.comptes) console.log(`    ${c.login.padEnd(20)} — ${c.qui}`);
  console.log("");
  console.log("  Animateurs par lien : générez leur lien depuis Animateurs.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
