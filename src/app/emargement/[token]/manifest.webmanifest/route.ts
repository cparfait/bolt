import { prisma } from "@/lib/db";
import { getIdentiteApp } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Manifeste d'installation, propre à chaque animateur.
 *
 * L'intérêt de l'installation est justement de **conserver le lien** : le jeton
 * est dans l'URL, un manifeste unique partagé par tous ramènerait chacun sur la
 * même page. `start_url` et `scope` portent donc le jeton de l'animateur, et
 * l'icône installée sur son téléphone ouvre directement sa feuille.
 *
 * Servi seulement pour un jeton existant : inutile de proposer l'installation
 * d'un lien révoqué ou inventé.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const coach = await prisma.coach.findUnique({
    where: { token },
    select: { prenom: true, nom: true, actif: true },
  });
  if (!coach || !coach.actif) {
    return new Response("Not found", { status: 404 });
  }

  const { nom } = await getIdentiteApp();
  const base = `/emargement/${token}`;
  const manifeste = {
    name: `${nom} — émargement`,
    short_name: "Émargement",
    description: `Feuilles de présence de ${coach.prenom} ${coach.nom}.`,
    lang: "fr",
    dir: "ltr",
    start_url: base,
    // La portée couvre tout /emargement/ et non le seul jeton : `start_url`
    // doit y être contenu, or « /emargement/<jeton>/ » exclurait justement
    // « /emargement/<jeton> ». Elle englobe au passage les fiches de séance.
    scope: "/emargement/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: "#006e46",
    icons: [
      {
        src: "/icones/bolt-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/icones/bolt-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  };

  return new Response(JSON.stringify(manifeste, null, 2), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      // Le jeton ne doit pas traîner dans un cache partagé.
      "cache-control": "private, no-store",
    },
  });
}
