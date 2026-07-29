"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { suggererAgents, type Suggestion } from "@/lib/actions/agents";
import { Input } from "@/components/ui";

/**
 * Barre de recherche d'agent du tableau de bord, avec suggestions.
 *
 * Le service des sports part souvent d'une question nominative — « est-ce que
 * Untel vient encore ? ». Proposer les agents dès les premières lettres évite
 * l'aller-retour par la page de résultats quand on sait déjà qui l'on cherche.
 * Entrée sans sélection reste possible : la recherche complète prend alors le
 * relais, y compris par service ou direction.
 */
export function RechercheRapide() {
  const router = useRouter();
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<Suggestion[]>([]);
  const [surligne, setSurligne] = useState(-1);
  const [ouvert, setOuvert] = useState(false);
  const [cherche, demarrer] = useTransition();
  const conteneur = useRef<HTMLDivElement>(null);

  // Anti-rebond : on n'interroge le serveur qu'une fois la frappe stabilisée.
  useEffect(() => {
    const q = terme.trim();
    if (q.length < 2) return;
    const minuteur = setTimeout(() => {
      demarrer(async () => {
        setResultats(await suggererAgents(q));
        setSurligne(-1);
      });
    }, 250);
    return () => clearTimeout(minuteur);
  }, [terme]);

  // Un clic ailleurs referme la liste : sans cela elle reste ouverte au-dessus
  // du contenu et masque les indicateurs.
  useEffect(() => {
    const dehors = (e: MouseEvent) => {
      if (!conteneur.current?.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("mousedown", dehors);
    return () => document.removeEventListener("mousedown", dehors);
  }, []);

  const assezLong = terme.trim().length >= 2;
  const affiches = assezLong ? resultats : [];
  const deroule = ouvert && assezLong;

  const rechercheComplete = () => {
    setOuvert(false);
    router.push(`/agents?q=${encodeURIComponent(terme.trim())}`);
  };

  const ouvrirFiche = (s: Suggestion) => {
    setOuvert(false);
    router.push(`/agents/${s.id}`);
  };

  return (
    <div ref={conteneur} className="relative mb-6">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (surligne >= 0 && affiches[surligne]) ouvrirFiche(affiches[surligne]);
          else if (assezLong) rechercheComplete();
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={terme}
            onChange={(e) => {
              setTerme(e.target.value);
              setOuvert(true);
            }}
            onFocus={() => setOuvert(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOuvert(false);
              if (affiches.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSurligne((i) => (i + 1) % affiches.length);
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSurligne((i) => (i <= 0 ? affiches.length - 1 : i - 1));
              }
            }}
            placeholder="Rechercher un agent — nom, identifiant, service…"
            autoComplete="off"
            role="combobox"
            aria-expanded={deroule}
            aria-controls="suggestions-agents"
            className="pl-9"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          Rechercher
        </button>
      </form>

      {deroule && (
        <div
          id="suggestions-agents"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          {affiches.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">
              {cherche
                ? "Recherche…"
                : `Aucun agent ne correspond à « ${terme.trim()} ».`}
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
              {affiches.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setSurligne(i)}
                    onClick={() => ouvrirFiche(s)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition ${
                      i === surligne ? "bg-brand-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{s.nom}</span>
                      <span className="block truncate text-xs text-slate-400">
                        {[s.login, s.detail].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-400">
                      {s.inscriptions > 0
                        ? `${s.inscriptions} inscription${s.inscriptions > 1 ? "s" : ""}`
                        : "aucune inscription"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={rechercheComplete}
            className="block w-full border-t border-slate-100 bg-slate-50 px-4 py-2 text-left text-xs font-medium text-slate-500 transition hover:bg-slate-100"
          >
            Voir tous les résultats pour « {terme.trim()} »
          </button>
        </div>
      )}
    </div>
  );
}
