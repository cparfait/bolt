"use client";

import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import {
  rechercherAgents,
  rechercherAgentsConnus,
  rechercherComptesAd,
} from "@/lib/actions/agents";
import type { Candidat } from "@/lib/comptes";
import { Field, Input } from "@/components/ui";

/**
 * Champ de recherche d'un agent, partagé par l'inscription et l'ajout d'un
 * participant ponctuel.
 *
 * Interroge le serveur après une pause de frappe : une collectivité compte
 * plusieurs milliers d'agents, un menu déroulant préchargé serait inutilisable —
 * et surtout il ne contiendrait que les agents déjà connectés, alors qu'à la
 * rentrée personne ne l'est encore. La recherche couvre donc aussi l'annuaire.
 *
 * Émet un champ caché `login` (le sAMAccountName), identifiant pivot entre Bolt
 * et l'Active Directory.
 */
export function ChampAgent({
  label = "Agent",
  hint = "Nom, prénom, identifiant ou adresse e-mail. La recherche couvre les comptes Bolt et l'annuaire Active Directory.",
  // « connus » restreint aux agents déjà présents dans Bolt : c'est ce que voit
  // un animateur, à qui l'on n'ouvre pas le répertoire de la collectivité.
  // « ad » écarte les participants hors annuaire, qui ne sont pas des cibles
  // de rattachement valables.
  source = "annuaire",
}: {
  label?: string;
  hint?: string;
  source?: "annuaire" | "connus" | "ad";
}) {
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<Candidat[]>([]);
  const [choisi, setChoisi] = useState<Candidat | null>(null);
  const [cherche, demarrer] = useTransition();

  // Anti-rebond : on n'interroge l'annuaire qu'une fois la frappe stabilisée.
  useEffect(() => {
    const q = terme.trim();
    if (q.length < 2) return;
    const minuteur = setTimeout(() => {
      demarrer(async () =>
        setResultats(
          source === "connus"
            ? await rechercherAgentsConnus(q)
            : source === "ad"
              ? await rechercherComptesAd(q)
              : await rechercherAgents(q),
        ),
      );
    }, 350);
    return () => clearTimeout(minuteur);
  }, [terme, source]);

  // Dérivé plutôt que stocké : évite de vider `resultats` depuis un effet, et
  // supprime le clignotement des anciens résultats quand on efface le champ.
  const affiches = terme.trim().length < 2 ? [] : resultats;

  return (
    <>
      <Field label={label} required hint={hint}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={terme}
            onChange={(e) => {
              setTerme(e.target.value);
              setChoisi(null);
            }}
            placeholder="Dupont, jdupont, j.dupont@…"
            autoComplete="off"
            className="pl-9"
          />
        </div>
      </Field>

      {choisi ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{choisi.nom}</p>
            <p className="truncate text-xs text-slate-500">
              {[choisi.login, choisi.service ?? choisi.direction, choisi.email]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setChoisi(null)}
            className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            Changer
          </button>
        </div>
      ) : (
        terme.trim().length >= 2 && (
          <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200">
            {cherche && affiches.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-400">Recherche…</p>
            ) : affiches.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-400">
                {source === "connus"
                  ? "Aucun agent trouvé parmi ceux déjà connus de Bolt. Le service des sports peut le chercher dans l'annuaire."
                  : source === "ad"
                    ? "Aucun compte Active Directory à ce nom. Son compte n'est peut-être pas encore créé, ou l'annuaire demande une synchronisation."
                    : "Aucun agent trouvé. Vérifiez l'orthographe, ou synchronisez l'annuaire depuis les paramètres."}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {affiches.map((c) => (
                  <li key={c.login}>
                    <button
                      type="button"
                      onClick={() => setChoisi(c)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{c.nom}</span>
                        <span className="block truncate text-xs text-slate-400">
                          {[c.login, c.service ?? c.direction].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {c.source === "annuaire" && (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                          annuaire
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      )}

      <input type="hidden" name="login" value={choisi?.login ?? ""} />
      {!choisi && (
        <p className="text-xs text-slate-400">Sélectionnez d&apos;abord un agent.</p>
      )}
    </>
  );
}
