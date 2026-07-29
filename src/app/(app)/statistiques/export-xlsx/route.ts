import { NextResponse, type NextRequest } from "next/server";
import { currentUser, estGestionnaire } from "@/lib/session";
import { classeurStatistiques } from "@/lib/xlsx";
import { saisonCourante } from "@/lib/saison";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Classeur Excel du bilan de fréquentation, prêt à circuler en comité QVT. */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user || !estGestionnaire(user)) {
    return new NextResponse("Accès refusé.", { status: 403 });
  }

  const saisonId =
    request.nextUrl.searchParams.get("saison") ?? (await saisonCourante())?.id;
  if (!saisonId) return new NextResponse("Aucune saison.", { status: 404 });

  const activiteId = request.nextUrl.searchParams.get("activite") ?? undefined;
  const classeur = await classeurStatistiques({ saisonId, activiteId });
  const saison = await prisma.saison.findUnique({ where: { id: saisonId } });
  await audit("EXPORT_XLSX", { userId: user.id, cible: saisonId });

  const nom = `bolt-frequentation-${saison?.nom ?? saisonId}.xlsx`;
  return new NextResponse(new Uint8Array(classeur), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${nom}"`,
    },
  });
}
