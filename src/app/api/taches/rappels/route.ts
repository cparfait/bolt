import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { envoyerRappels } from "@/lib/rappels";

export const dynamic = "force-dynamic";

/**
 * Déclenchement des rappels par un ordonnanceur externe (cron, tâche planifiée
 * Windows, Portainer). Facultatif : sans cron, le passage d'un utilisateur sur
 * l'application déclenche la même vérification.
 *
 *   curl -H "Authorization: Bearer $CRON_TOKEN" https://bolt…/api/taches/rappels
 *
 * Sans CRON_TOKEN défini, la route est fermée : une route d'envoi de masse
 * ouverte à tous serait un relais de spam.
 */
function jetonValide(entete: string | null): boolean {
  const attendu = process.env.CRON_TOKEN ?? "";
  if (attendu.length < 16) return false;
  const fourni = (entete ?? "").replace(/^Bearer\s+/i, "");
  if (fourni.length !== attendu.length) return false;
  // Comparaison à temps constant : évite de révéler le jeton octet par octet.
  return timingSafeEqual(Buffer.from(fourni), Buffer.from(attendu));
}

export async function GET(request: NextRequest) {
  if (!jetonValide(request.headers.get("authorization"))) {
    return NextResponse.json({ erreur: "Jeton invalide ou CRON_TOKEN non défini." }, { status: 401 });
  }
  const res = await envoyerRappels();
  return NextResponse.json(res);
}
