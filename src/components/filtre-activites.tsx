import Link from "next/link";

/**
 * Barre de sélection des activités.
 *
 * Rendue en liens plutôt qu'en état client : le filtre se retrouve dans l'URL,
 * donc partageable et conservé au rechargement — et la page reste entièrement
 * serveur. Chaque pastille porte la couleur de son activité, pleine quand elle
 * est sélectionnée.
 */
export function FiltreActivites({
  activites,
  selection,
  base,
  params,
}: {
  activites: { id: string; nom: string; couleur: string; actif: boolean }[];
  selection?: string;
  base: string;
  // Paramètres à conserver dans le lien (période sélectionnée, saison…) :
  // sans cela, cliquer sur une activité réinitialiserait les autres filtres.
  params?: Record<string, string | undefined>;
}) {
  if (activites.length === 0) return null;

  const lien = (activiteId?: string) => {
    const q = new URLSearchParams();
    for (const [cle, valeur] of Object.entries(params ?? {})) {
      if (valeur) q.set(cle, valeur);
    }
    if (activiteId) q.set("activite", activiteId);
    const suffixe = q.toString();
    return suffixe ? `${base}?${suffixe}` : base;
  };

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <Link
        href={lien()}
        className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
          selection
            ? "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
            : "bg-slate-900 text-white"
        }`}
      >
        Toutes
      </Link>
      {activites.map((a) => {
        const active = selection === a.id;
        return (
          <Link
            key={a.id}
            href={lien(a.id)}
            aria-current={active ? "true" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              a.actif ? "" : "opacity-50"
            }`}
            style={
              active
                ? { backgroundColor: a.couleur, color: "#fff" }
                : {
                    backgroundColor: `${a.couleur}14`,
                    color: a.couleur,
                    boxShadow: `inset 0 0 0 1px ${a.couleur}33`,
                  }
            }
          >
            {a.nom}
          </Link>
        );
      })}
    </div>
  );
}
