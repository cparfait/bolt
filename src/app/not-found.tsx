import Link from "next/link";
import { headers } from "next/headers";
import { clientIp, estInterne } from "@/lib/net";

export default async function NotFound() {
  // Depuis Internet, `/` n'est pas publiée : renvoyer vers l'espace agent,
  // seul écran joignable de là où se trouve le visiteur.
  let accueil = "/";
  try {
    if (!estInterne(clientIp(await headers()))) accueil = "/mes-activites";
  } catch {
    // hors contexte de requête : l'accueil par défaut convient
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-sm text-center">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-2 text-xl font-semibold">Page introuvable</h1>
        <p className="mt-2 text-sm text-slate-500">
          Cette page n&apos;existe pas, ou vous n&apos;y avez pas accès.
        </p>
        <Link
          href={accueil}
          className="mt-6 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </main>
  );
}
