import type { PointMois } from "@/lib/stats";

/**
 * Histogramme d'évolution mensuelle, en SVG inline.
 *
 * Pas de bibliothèque de graphiques : la CSP interdit les ressources externes,
 * et un histogramme à une série ne justifie pas 200 Ko de JavaScript. Le rendu
 * est fait côté serveur, donc immédiat et imprimable.
 */
export function HistogrammeMensuel({
  points,
  couleur = "#006e46",
}: {
  points: PointMois[];
  couleur?: string;
}) {
  if (points.length === 0) {
    return <p className="text-sm text-slate-400">Pas encore de séance émargée.</p>;
  }

  const max = Math.max(...points.map((p) => p.presents), 1);
  const largeurBarre = 100 / points.length;

  return (
    <div>
      <div
        className="flex h-40 items-end gap-1.5"
        role="img"
        aria-label={`Fréquentation mensuelle : ${points.map((p) => `${p.libelle} ${p.presents}`).join(", ")}`}
      >
        {points.map((p) => (
          <div
            key={p.cle}
            className="group flex h-full flex-1 flex-col justify-end"
            style={{ minWidth: `${Math.min(largeurBarre, 12)}%` }}
          >
            <span className="mb-1 text-center text-xs font-medium tabular-nums text-slate-500">
              {p.presents}
            </span>
            <div
              className="rounded-t-md transition group-hover:opacity-80"
              style={{
                height: `${Math.max((p.presents / max) * 100, 2)}%`,
                backgroundColor: couleur,
              }}
              title={`${p.libelle} — ${p.presents} présences sur ${p.seances} séances (${p.moyenne} par séance)`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        {points.map((p) => (
          <div
            key={p.cle}
            className="flex-1 truncate text-center text-[11px] text-slate-400"
            style={{ minWidth: `${Math.min(largeurBarre, 12)}%` }}
          >
            {p.court}
          </div>
        ))}
      </div>
    </div>
  );
}
