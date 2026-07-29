import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { estGestionnaire } from "@/lib/session";
import { exportCsv } from "@/lib/stats";
import { saisonCourante } from "@/lib/saison";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Export CSV du détail des séances — pièce jointe du bilan QVT. */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user || !estGestionnaire(user)) {
    return new NextResponse("Accès refusé.", { status: 403 });
  }

  const saisonId =
    request.nextUrl.searchParams.get("saison") ?? (await saisonCourante())?.id;
  if (!saisonId) return new NextResponse("Aucune saison.", { status: 404 });

  const activiteId = request.nextUrl.searchParams.get("activite") ?? undefined;
  const csv = await exportCsv({ saisonId, activiteId });
  await audit("EXPORT_STATISTIQUES", { userId: user.id, cible: saisonId });

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="bolt-frequentation.csv"`,
    },
  });
}
