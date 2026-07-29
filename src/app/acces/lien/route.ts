import { NextResponse, type NextRequest } from "next/server";
import { consommerLien } from "@/lib/magic";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Consommation du lien de connexion reçu par e-mail (usage unique). */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const user = await consommerLien(token);
  if (!user) {
    return NextResponse.redirect(new URL("/acces?erreur=lien", request.url));
  }
  const session = await getSession();
  session.userId = user.id;
  await session.save();
  return NextResponse.redirect(new URL("/mes-activites", request.url));
}
