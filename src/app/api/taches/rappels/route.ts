import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { envoyerRappels } from "@/lib/rappels";
import { purger } from "@/lib/purge";
import { declencherSyncSiBesoin } from "@/lib/annuaire";

export const dynamic = "force-dynamic";

/**
 * Déclenchement des rappels par un ordonnanceur externe (cron, tâche planifiée
 * Windows, Portainer). Facultatif : sans cron, le passage d'un utilisateur sur
 * l'application déclenche la même vérification.
 *
 * Applique au passage les durées de conservation (src/lib/purge.ts). Le nom de
 * la route ne le dit pas — il est déjà repris dans des tâches planifiées, le
 * renommer casserait des installations — mais c'est le bon endroit : un
 * ordonnanceur qui appelle Bolt chaque nuit doit aussi faire le ménage.
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
  const purge = await purger();

  // Passe par le déclencheur, qui porte le verrou quotidien : un cron réglé à
  // l'heure ne martèlera donc pas le contrôleur de domaine, et un annuaire
  // injoignable ne fera pas échouer les rappels déjà partis.
  const sync = await declencherSyncSiBesoin("cron");

  return NextResponse.json({
    ...res,
    purge,
    annuaire: sync ? sync.message : "déjà synchronisé aujourd'hui, ou annuaire non configuré",
  });
}
