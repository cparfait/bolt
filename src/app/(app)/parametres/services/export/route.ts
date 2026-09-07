import { NextResponse } from "next/server";
import { currentUser, estGestionnaire } from "@/lib/session";
import { exporterParametrage } from "@/lib/parametrage";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Export du paramétrage des services, au format de cybermois : le fichier
 * s'importe tel quel dans l'autre outil, et réciproquement.
 */
export async function GET() {
  const user = await currentUser();
  if (!user || !estGestionnaire(user)) {
    return new NextResponse("Accès refusé.", { status: 403 });
  }
  const parametrage = await exporterParametrage();
  await audit("PARAMETRAGE_SERVICES_EXPORTE", { userId: user.id });
  return new NextResponse(JSON.stringify(parametrage, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="bolt-services.json"`,
    },
  });
}
