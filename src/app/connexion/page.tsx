import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { getGeneralSettings } from "@/lib/settings";
import { Logos, TitreConnexion } from "@/components/ui";
import { LoginForm } from "./login-form";

export default async function ConnexionPage() {
  const user = await currentUser();
  if (user) redirect("/");
  const g = await getGeneralSettings();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Logos ville={g.logoVille} operation={g.logo} orgName={g.orgName} />
          <TitreConnexion
            logo={g.logoVille || g.logo}
            orgName={g.orgName}
            appName={g.appName}
            appDescription={g.appDescription}
          />
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-slate-500">
          Votre mot de passe est celui de votre session Windows. L&apos;identifiant
          peut être celui de votre session ou votre adresse professionnelle.
        </p>
        {/* Les agents sans compte Windows individuel (terrain, crèches,
            gardiennage) passent par le lien envoyé sur leur adresse e-mail.
            Le renvoi n'apparaît que si ce mode est activé : sinon /acces est
            une impasse qui dirait simplement « pas activé ». */}
        {g.lienMagiqueActif && (
          <p className="mt-2 text-center text-xs text-slate-500">
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
