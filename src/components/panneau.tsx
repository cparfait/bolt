import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Bloc dépliable. Volontairement en `<details>` natif : pas d'état client à
 * hydrater, fonctionne sans JavaScript, et le contenu reste accessible au
 * clavier et aux lecteurs d'écran.
 */
export function Panneau({
  titre,
  sousTitre,
  ouvert,
  children,
}: {
  titre: string;
  sousTitre?: string;
  ouvert?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={ouvert}
      className="group rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
        <div>
          <span className="text-sm font-semibold">{titre}</span>
          {sousTitre && <p className="text-xs text-slate-400">{sousTitre}</p>}
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-100 p-5">{children}</div>
    </details>
  );
}
