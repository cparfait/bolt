import { Dumbbell } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { getGeneralSettings } from "@/lib/settings";
import { TitreConnexion } from "@/components/ui";
import { LoginForm } from "./login-form";

export default async function ConnexionPage() {
  const user = await currentUser();
  if (user) redirect("/");
  const g = await getGeneralSettings();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          {g.logo ? (
            // Pas de cadre carré ni d'arrondi : le logo importé n'a ni forme ni
            // proportions connues à l'avance (texte à côté d'une icône, etc.).
            // eslint-disable-next-line @next/next/no-img-element -- data URI, next/image ne s'applique pas
            <img
              src={g.logo}
              alt={g.orgName}
              className="max-h-20 w-auto max-w-[280px] object-contain"
            />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/20">
              <Dumbbell className="h-6 w-6" />
            </span>
          )}
          <TitreConnexion
            logo={g.logo}
            orgName={g.orgName}
            appName={g.appName}
            appDescription={g.appDescription}
          />
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-slate-400">
          Connectez-vous avec votre identifiant Windows habituel.
        </p>
        {/* Les agents sans compte Windows individuel (terrain, crèches,
            gardiennage) passent par le lien envoyé sur leur adresse e-mail.
            Le renvoi n'apparaît que si ce mode est activé : sinon /acces est
            une impasse qui dirait simplement « pas activé ». */}
        {g.lienMagiqueActif && (
          <p className="mt-2 text-center text-xs text-slate-400">
            Pas d&apos;identifiant Windows ?{" "}
            <Link href="/acces" className="font-medium text-brand-600 hover:underline">
              Connexion par lien e-mail
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
