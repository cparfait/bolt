import { NextResponse, type NextRequest } from "next/server";
import { consommerLien } from "@/lib/magic";
import { getSession } from "@/lib/session";
import { getGeneralSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Consommation du lien de connexion reçu par e-mail (usage unique).
 *
 * Les redirections se construisent sur l'URL publique configurée, jamais sur
 * `request.url` : derrière la chaîne de proxys, l'en-tête Host vu par le
 * conteneur n'est pas fiable — un maillon qui l'omet enverrait l'agent vers
 * l'adresse d'écoute interne (https://0.0.0.0:3000/…), une impasse.
 */
export async function GET(request: NextRequest) {
  const g = await getGeneralSettings();
  const base = g.appUrl || request.url;

  const token = request.nextUrl.searchParams.get("token") ?? "";
  const user = await consommerLien(token);
  if (!user) {
    return NextResponse.redirect(new URL("/acces?erreur=lien", base));
  }
  const session = await getSession();
  session.userId = user.id;
  await session.save();
  return NextResponse.redirect(new URL("/mes-activites", base));
}
