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

  // Le nom du fichier n'est pas une donnée de confiance : quand `?saison=`
  // ne désigne aucune saison, on retombe sur le paramètre d'URL lui-même.
  // Guillemets et retours à la ligne en sont donc retirés avant de le poser
  // dans l'en-tête. Le `filename*` sert d'ailleurs à deux choses : il porte la
  // version non tronquée, et il est le seul des deux qu'un client de
  // messagerie lit correctement quand la saison a un nom accentué.
  const brut = `bolt-frequentation-${saison?.nom ?? saisonId}.xlsx`;
  const nom = brut.replace(/["\\\r\n]/g, "");
  return new NextResponse(new Uint8Array(classeur), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${nom}"; filename*=UTF-8''${encodeURIComponent(brut)}`,
    },
  });
}
