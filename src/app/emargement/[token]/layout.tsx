import type { Metadata, Viewport } from "next";

// `themeColor` appartient à l'export `viewport` depuis Next 15 : laissé dans
// les métadonnées, il est ignoré avec un avertissement à la construction.
export const viewport: Viewport = { themeColor: "#006e46" };

/**
 * Enveloppe des écrans d'émargement.
 *
 * Son seul rôle est de rattacher le manifeste d'installation propre au jeton :
 * l'animateur peut alors poser l'application sur son écran d'accueil et
 * retrouver **sa** feuille sans avoir à conserver le lien dans ses messages.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "Émargement — Bolt",
    manifest: `/emargement/${token}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "Émargement", statusBarStyle: "default" },
  };
}

export default function EmargementLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
