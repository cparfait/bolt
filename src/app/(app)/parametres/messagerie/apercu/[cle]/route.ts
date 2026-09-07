import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { exemplesMail } from "@/lib/mail-exemples";
import { rendreMail } from "@/lib/mail";

export const dynamic = "force-dynamic";

/**
 * Aperçu d'un message d'exemple, tel qu'il arrive dans une boîte de réception.
 *
 * Servi comme document à part, affiché dans une `iframe` : le gabarit des
 * courriels est écrit en tableaux et en styles en ligne, pour Outlook. Injecté
 * dans la page, il hériterait des styles de l'application et montrerait autre
 * chose que ce que le destinataire reçoit — ce qui viderait l'aperçu de son
 * intérêt.
 *
 * Réservé à l'administrateur, comme le reste de cet écran.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cle: string }> },
) {
  const user = await currentUser();
  if (!user || user.role !== "ADMIN") {
    return new NextResponse("Accès refusé.", { status: 403 });
  }
  const { cle } = await params;
  const exemple = (await exemplesMail()).find((e) => e.cle === cle);
  if (!exemple) return new NextResponse("Message inconnu.", { status: 404 });

  return new NextResponse(await rendreMail(exemple.objet, exemple.corps), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
