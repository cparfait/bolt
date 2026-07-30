import type { Metadata, Viewport } from "next";
import { getIdentiteApp } from "@/lib/settings";
import "./globals.css";

/**
 * Titre de l'onglet, repris du paramétrage — c'est aussi ce que le navigateur
 * enregistre en favori. `getIdentiteApp` retombe sur les valeurs par défaut si
 * la base est momentanément injoignable : un titre générique vaut mieux qu'une
 * page d'erreur.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { nom, description } = await getIdentiteApp();
  return {
    title: `${nom} — ${description}`,
    description: "Suivi des activités sportives des agents de la collectivité",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // évite le zoom involontaire pendant l'émargement
  themeColor: "#006e46",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
