"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Search, UserPlus } from "lucide-react";
import {
  ajouterParticipantEmargement,
  listerServicesEmargement,
  rechercherParticipantEmargement,
} from "@/lib/actions/emargement";
import type { CandidatFeuille } from "@/lib/comptes";
import type { ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";

/**
 * Ajout d'un participant venu sans être inscrit, depuis la feuille mobile.
 *
 * Replié par défaut : le cas est réel mais minoritaire, et la feuille doit
 * rester une liste de noms avec de gros boutons. La recherche ne porte que sur
 * les agents déjà connus de Bolt, amputée de ceux qui sont déjà sur la feuille —
 * les proposer ne ferait qu'allonger la liste de doublons impossibles.
 */
export function AjouterParticipantMobile({
  token,
  seanceId,
}: {
  token: string;
  seanceId: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    ajouterParticipantEmargement,
    null,
  );
  const [ouvert, setOuvert] = useState(false);

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-sm transition active:scale-[0.99]"
      >
        <UserPlus className="h-4 w-4 text-slate-400" /> Quelqu&apos;un d&apos;autre est venu
      </button>
    );
  }

  return (
    <form
      action={action}
      className="mb-3 space-y-3 rounded-2xl border border-brand-200 bg-brand-50/50 p-4"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="seanceId" value={seanceId} />

      {state?.error && (
        <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
          {state.success}
        </p>
      )}

      {/* Remonté à chaque succès : la sélection et la recherche repartent de
          zéro, car il y a souvent deux ou trois arrivants d'affilée. */}
      <Selecteur
        key={state?.success ?? "initial"}
        token={token}
        seanceId={seanceId}
        onFermer={() => setOuvert(false)}
      />
    </form>
  );
}

function Selecteur({
  token,
  seanceId,
  onFermer,
}: {
  token: string;
  seanceId: string;
  onFermer: () => void;
}) {
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<CandidatFeuille[]>([]);
  const [choisi, setChoisi] = useState<CandidatFeuille | null>(null);
  const [cherche, demarrer] = useTransition();
  // Personne introuvable dans Bolt : l'animateur la crée par son nom, située
  // au besoin par son service — la liste des services n'expose pas l'annuaire.
  const [horsAnnuaire, setHorsAnnuaire] = useState(false);
  const [services, setServices] = useState<string[] | null>(null);

  const activerHorsAnnuaire = () => {
    setHorsAnnuaire(true);
    if (services === null) {
      listerServicesEmargement(token, seanceId).then(setServices);
    }
  };

  // Anti-rebond : la saisie se fait au pouce, sur un réseau souvent médiocre.
  useEffect(() => {
    const q = terme.trim();
    if (q.length < 2) return;
    const minuteur = setTimeout(() => {
      demarrer(async () =>
        setResultats(await rechercherParticipantEmargement(token, seanceId, q)),
      );
    }, 350);
    return () => clearTimeout(minuteur);
  }, [terme, token, seanceId]);

  const affiches = terme.trim().length < 2 ? [] : resultats;

  return (
    <>
      <input type="hidden" name="userId" value={choisi?.id ?? ""} />
      <input type="hidden" name="nomLibre" value={horsAnnuaire ? terme.trim() : ""} />

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">
          Qui est venu ?
        </span>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={choisi ? choisi.nom : terme}
            onChange={(e) => {
              setTerme(e.target.value);
              setChoisi(null);
              setHorsAnnuaire(false);
            }}
            placeholder="Nom de l'agent"
            autoComplete="off"
            className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-9 pr-3.5 text-base outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
          />
        </span>
      </label>

      {!choisi && !horsAnnuaire && terme.trim().length >= 2 && (
        <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white">
          {cherche && affiches.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">Recherche…</p>
          ) : affiches.length === 0 ? (
            <div className="space-y-2 px-4 py-3">
              <p className="text-sm text-slate-400">
                Personne ne porte ce nom dans Bolt — élu, stagiaire ou invité
                d&apos;un autre organisme, peut-être.
              </p>
              <button
                type="button"
                onClick={activerHorsAnnuaire}
                className="w-full rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm font-medium text-brand-700 active:bg-brand-100"
              >
                Ajouter « {terme.trim()} » quand même
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {affiches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setChoisi(c)}
                    className="w-full px-4 py-3 text-left active:bg-slate-50"
                  >
                    <span className="block text-sm font-medium">{c.nom}</span>
                    {c.situation && (
                      <span className="block truncate text-xs text-slate-400">
                        {c.situation}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {horsAnnuaire && (
        <div className="space-y-2.5 rounded-xl border border-brand-200 bg-white p-3.5">
          <p className="text-sm text-slate-600">
            <span className="font-medium">{terme.trim()}</span> sera créé comme
            participant hors annuaire — le service des sports pourra compléter
            sa fiche.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Son service, si vous le connaissez
            </span>
            <select
              name="service"
              defaultValue=""
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-brand-500"
            >
              <option value="">Je ne sais pas / extérieur</option>
              {(services ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* Décochée par défaut : pointer quelqu'un constate sa venue, l'inscrire
          engage une place sur toute la saison. Ce sont deux décisions, et la
          seconde n'a pas à se prendre par inadvertance — beaucoup de passages
          restent des essais sans lendemain. */}
      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          name="inscrire"
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>
          <span className="block font-medium">Proposer son inscription au créneau</span>
          <span className="block text-xs text-slate-500">
            Le service des sports recevra la demande et décidera.
          </span>
        </span>
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onFermer}
          className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-600"
        >
          Fermer
        </button>
        <SubmitButton
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
          pendingLabel="Ajout…"
          disabled={!choisi && !horsAnnuaire}
        >
          <UserPlus className="h-4 w-4" />
          {choisi
            ? `Ajouter ${choisi.nom.split(" ")[0]}`
            : horsAnnuaire
              ? `Ajouter ${terme.trim().split(" ")[0]}`
              : "Choisissez un agent"}
        </SubmitButton>
      </div>
    </>
  );
}
