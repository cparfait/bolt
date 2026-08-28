import { LogOut } from "lucide-react";
import { prisma } from "@/lib/db";
import { estGestionnaire, requireUser } from "@/lib/session";
import { logoutAction } from "@/lib/actions/auth";
import { NavMobile, Sidebar, type Compteurs } from "@/components/nav";
import { ROLE_LABELS } from "@/lib/constants";
import { getGeneralSettings } from "@/lib/settings";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const g = await getGeneralSettings();

  // Demandes d'inscription en attente d'arbitrage : le service des sports doit
  // les voir depuis n'importe quel écran, pas seulement en ouvrant la page.
  const compteurs: Compteurs = {};
  if (estGestionnaire(user)) {
    const aValider = await prisma.inscription.count({
      where: { statut: "EN_ATTENTE", creneau: { saison: { active: true } } },
    });
    if (aValider > 0) compteurs["/inscriptions"] = aValider;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar role={user.role} compteurs={compteurs} appName={g.appName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <NavMobile role={user.role} compteurs={compteurs} appName={g.appName} />
        <header className="sticky top-0 z-10 flex h-14 items-center justify-end gap-4 border-b border-slate-200 bg-white/80 px-4 backdrop-blur lg:px-6">
          <div className="text-right">
            <p className="text-sm font-medium leading-tight">{user.displayName}</p>
            <p className="text-xs leading-tight text-slate-400">{ROLE_LABELS[user.role]}</p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              title="Se déconnecter"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 lg:p-8">{children}</main>
        {/* Les mentions d'information doivent rester consultables après coup,
            pas seulement au moment où l'agent les accepte pour s'inscrire. */}
        <footer className="mx-auto w-full max-w-6xl px-4 pb-6 text-xs text-slate-400 lg:px-8">
          <a href="/mentions" className="underline-offset-2 hover:underline">
            Mentions d&apos;information et protection des données
          </a>
        </footer>
      </div>
    </div>
  );
}
