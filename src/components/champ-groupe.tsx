"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Search, X } from "lucide-react";
import { rechercherGroupes } from "@/lib/actions/parametres";
import { Field, Input } from "@/components/ui";

/**
 * Champ « groupe Active Directory » avec suggestions.
 *
 * Reste un champ libre : on doit pouvoir coller un DN complet, et le
 * paramétrage doit rester possible même si l'annuaire est momentanément
 * injoignable ou si le compte de service n'est pas encore renseigné. Les
 * suggestions ne sont qu'une aide — mais une aide décisive : une faute de
 * frappe ici interdit l'accès à toute la collectivité.
 */
export function ChampGroupe({
  name,
  label,
  hint,
  defaultValue,
  placeholder,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  const [valeur, setValeur] = useState(defaultValue ?? "");
  const [suggestions, setSuggestions] = useState<{ cn: string; dn: string }[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [cherche, demarrer] = useTransition();

  useEffect(() => {
    if (!ouvert) return;
    const q = valeur.trim();
    // Un DN complet est déjà explicite : inutile de proposer autre chose.
    if (q.includes("=")) return;
    const minuteur = setTimeout(() => {
      demarrer(async () => setSuggestions(await rechercherGroupes(q)));
    }, 350);
    return () => clearTimeout(minuteur);
  }, [valeur, ouvert]);

  const listeVisible = ouvert && !valeur.includes("=");

  return (
    <div className="relative">
      <Field label={label} hint={hint}>
        <div className="relative">
          <Input
            name={name}
            value={valeur}
            onChange={(e) => {
              setValeur(e.target.value);
              setOuvert(true);
            }}
            onFocus={() => setOuvert(true)}
            placeholder={placeholder}
            autoComplete="off"
            className="pr-9"
          />
          <button
            type="button"
            aria-label={ouvert ? "Masquer les suggestions" : "Chercher dans l'annuaire"}
            onClick={() => setOuvert((o) => !o)}
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 transition hover:text-slate-600"
          >
            {ouvert ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          </button>
        </div>
      </Field>

      {listeVisible && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {cherche && suggestions.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">Interrogation de l&apos;annuaire…</p>
          ) : suggestions.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">
              Aucun groupe proposé. Renseignez d&apos;abord le compte de service, ou
              saisissez le nom exact.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {suggestions.map((g) => (
                <li key={g.dn}>
                  <button
                    type="button"
                    onClick={() => {
                      setValeur(g.cn);
                      setOuvert(false);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{g.cn}</span>
                      <span className="block truncate text-xs text-slate-400">{g.dn}</span>
                    </span>
                    {valeur === g.cn && (
                      <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
