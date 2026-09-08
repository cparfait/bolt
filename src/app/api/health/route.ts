import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Identifiant de la version servie.
 *
 * Next écrit `.next/BUILD_ID` à chaque construction : deux images différentes
 * ne le partagent jamais, la même image le porte partout. Lu une fois au
 * chargement du module — le fichier ne change pas sous un serveur qui tourne.
 *
 * Il répond à la question qu'on se pose après un déploiement, et qu'on ne
 * savait pas trancher depuis un téléphone : « est-ce que je vois l'ancienne
 * version, ou est-ce mon cache ? ». Une mise à jour qui échoue laisse le
 * conteneur précédent en place et ressemble en tout point à un cache tenace —
 * c'est un aller-retour d'une demi-heure à chaque fois. Deux onglets suffisent
 * désormais : si l'identifiant n'a pas bougé, ce n'est pas le navigateur.
 *
 * Il n'apprend rien à personne : c'est une empreinte opaque, sans lien avec le
 * code ni avec les données. La route est publiée (voir src/proxy.ts) parce
 * qu'elle sert de sonde au healthcheck Docker.
 */
const VERSION = (() => {
  try {
    return readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    // Serveur de développement, ou fichier déplacé : la sonde ne doit pas
    // échouer pour si peu.
    return "inconnue";
  }
})();

/** Sonde du healthcheck Docker : vérifie que la base répond. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", version: VERSION });
  } catch {
    return NextResponse.json({ status: "degraded", version: VERSION }, { status: 503 });
  }
}
