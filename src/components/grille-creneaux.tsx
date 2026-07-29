import type { CaseGrille } from "@/lib/stats";
import { JOUR_LABELS, JOURS } from "@/lib/dates";

/**
 * Remplissage moyen par jour et tranche horaire.
 *
 * Volontairement une grille et non un graphique : on n'y cherche pas une
 * tendance mais un trou. Les cases vides — un créneau qu'on pourrait ouvrir —
 * comptent autant que les pleines, elles restent donc dessinées.
 *
 * Seuls les jours et les heures réellement utilisés sont affichés : dessiner
 * les sept jours et vingt-quatre heures produirait un damier illisible pour
 * cinq activités.
 */
export function GrilleCreneaux({ cases }: { cases: CaseGrille[] }) {
  if (cases.length === 0) {
    return <p className="text-sm text-slate-400">Aucune séance émargée sur la période.</p>;
  }

  const heures = [...new Set(cases.map((c) => c.heure))].sort((a, b) => a - b);
  const jours = JOURS.filter((j) => cases.some((c) => c.jour === j));
  const parCle = new Map(cases.map((c) => [`${c.jour}-${c.heure}`, c]));

  /** Du plus pâle au plus soutenu : le taux se lit avant les chiffres. */
  const teinte = (taux: number) => {
    if (taux >= 90) return "bg-emerald-600 text-white";
    if (taux >= 70) return "bg-emerald-400 text-emerald-950";
    if (taux >= 50) return "bg-amber-300 text-amber-950";
    if (taux > 0) return "bg-red-200 text-red-900";
    return "bg-slate-50 text-slate-300";
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="w-16" />
            {jours.map((j) => (
              <th
                key={j}
                className="pb-1 text-xs font-medium uppercase tracking-wide text-slate-400"
              >
                {JOUR_LABELS[j].slice(0, 3)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {heures.map((h) => (
            <tr key={h}>
              <th className="pr-2 text-right text-xs font-medium tabular-nums text-slate-400">
                {String(h).padStart(2, "0")} h
              </th>
              {jours.map((j) => {
                const c = parCle.get(`${j}-${h}`);
                if (!c) {
                  return (
                    <td key={j} className="rounded-lg bg-slate-50/60 py-3 text-center">
                      <span className="text-xs text-slate-300">—</span>
                    </td>
                  );
                }
                return (
                  <td
                    key={j}
                    title={`${c.activites.join(", ")} · ${c.presentsMoyens} présents en moyenne sur ${c.placesMoyennes} places`}
                    className={`rounded-lg px-2 py-2 text-center ${teinte(c.tauxRemplissage)}`}
                  >
                    <span className="block text-sm font-semibold tabular-nums">
                      {c.tauxRemplissage}%
                    </span>
                    <span className="block truncate text-[11px] opacity-80">
                      {c.activites.join(", ")}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-red-200" /> moins de 50 %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-amber-300" /> 50 à 70 %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-emerald-400" /> 70 à 90 %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-emerald-600" /> 90 % et plus
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-slate-50 ring-1 ring-inset ring-slate-200" />
          aucun créneau
        </span>
      </div>
    </div>
  );
}
