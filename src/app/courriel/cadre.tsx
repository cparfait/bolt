import type { ReactNode } from "react";
import { getGeneralSettings } from "@/lib/settings";
import { Logos, TitreConnexion } from "@/components/ui";

/**
 * Habillage des pages ouvertes depuis un courriel.
 *
 * Les mêmes logos et le même titre que les écrans d'accès : la personne arrive
 * d'une boîte de réception, souvent sur un téléphone, et doit reconnaître en
 * une seconde de quelle application il s'agit avant de cliquer sur quoi que ce
 * soit. Une page nue portant un bouton ressemblerait exactement à ce contre
 * quoi on lui demande de se méfier.
 */
export async function CadreCourriel({ children }: { children: ReactNode }) {
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
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {children}
        </div>
        {g.contactEmail && (
          <p className="mt-6 text-center text-xs text-slate-500">
            Une question ? Écrivez au service des sports :{" "}
            <a href={`mailto:${g.contactEmail}`} className="underline">
              {g.contactEmail}
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
