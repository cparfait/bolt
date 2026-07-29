import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import type { Ecart } from "@/lib/stats";
import { Stat } from "@/components/ui";

/**
 * Indicateur assorti de son écart avec la saison précédente.
 *
 * « 62 % de présence » ne dit rien seul : c'est l'évolution qui se commente en
 * comité. L'écart n'apparaît que s'il existe une saison antérieure — le premier
 * exercice n'a rien à comparer, et un « +62 » parti de zéro serait trompeur.
 *
 * `sens` inverse la lecture des couleurs pour les indicateurs où la baisse est
 * une bonne nouvelle (annulations, absences).
 */
export function StatComparee({
  label,
  value,
  suffixe,
  hint,
  accent,
  href,
  ecart,
  sens = "hausse",
}: {
  label: string;
  value: string | number;
  suffixe?: string;
  hint?: string;
  accent?: string;
  href?: string;
  ecart: Ecart | null;
  sens?: "hausse" | "baisse";
}) {
  const rappel = (() => {
    if (!ecart) return hint;
    if (ecart.delta === 0) return `stable — ${ecart.precedent}${suffixe ?? ""} la saison passée`;
    const signe = ecart.delta > 0 ? "+" : "";
    return `${signe}${ecart.delta}${suffixe ?? ""} vs saison passée (${ecart.precedent}${suffixe ?? ""})`;
  })();

  return (
    <div className="relative">
      <Stat label={label} value={value} suffixe={suffixe} hint={rappel} accent={accent} href={href} />
      {ecart && ecart.delta !== 0 && (
        <span
          className={`pointer-events-none absolute right-4 top-4 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
            (ecart.delta > 0) === (sens === "hausse")
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {ecart.delta > 0 ? (
            <ArrowUpRight className="h-3 w-3" />
          ) : (
            <ArrowDownRight className="h-3 w-3" />
          )}
          {Math.abs(ecart.delta)}
          {suffixe}
        </span>
      )}
      {ecart && ecart.delta === 0 && (
        <span className="pointer-events-none absolute right-4 top-4 inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          <ArrowRight className="h-3 w-3" /> =
        </span>
      )}
    </div>
  );
}
