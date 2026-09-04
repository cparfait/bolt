import { LogOut } from "lucide-react";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { estGestionnaire, requireAgent } from "@/lib/session";
import { logoutAction } from "@/lib/actions/auth";
import { NavMobile, Sidebar, type Compteurs } from "@/components/nav";
import { ROLE_LABELS } from "@/lib/constants";
import { getGeneralSettings } from "@/lib/settings";
import { compterDemandesEnAttente } from "@/lib/demandes";
import { clientIp, estInterne } from "@/lib/net";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireAgent();
  const g = await getGeneralSettings();

  // Depuis Internet, l'espace personnel et rien d'autre : `requireUser` refuse
  // déjà les écrans de gestion, mais les laisser dans la navigation offrirait
  // des liens qui ne mènent qu'à une redirection.
  const externe = !estInterne(clientIp(await headers()));

  // Demandes d'inscription en attente d'arbitrage : le service des sports doit
  // les voir depuis n'importe quel écran, pas seulement en ouvrant la page.
  const compteurs: Compteurs = {};
  if (estGestionnaire(user) && !externe) {
    const aValider = await prisma.inscription.count({
      where: { statut: "EN_ATTENTE", creneau: { saison: { active: true } } },
    });
    if (aValider > 0) compteurs["/inscriptions"] = aValider;

    // Une demande d'accès qui dort, c'est quelqu'un qui attend sans savoir
    // quoi : elle doit se voir depuis n'importe quel écran, comme les
    // inscriptions à arbitrer.
    const demandes = await compterDemandesEnAttente();
    if (demandes > 0) compteurs["/agents/demandes"] = demandes;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        role={user.role}
        compteurs={compteurs}
        demandesActives={g.demandeAccesActive}
        externe={externe}
        appName={g.appName}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <NavMobile
          role={user.role}
          compteurs={compteurs}
          demandesActives={g.demandeAccesActive}
          externe={externe}
          appName={g.appName}
          utilisateur={{ nom: user.displayName, role: ROLE_LABELS[user.role] }}
        />
        <header className="sticky top-0 z-10 hidden h-14 md:flex items-center justify-end gap-4 border-b border-slate-200 bg-white/80 px-4 backdrop-blur lg:px-6">
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
