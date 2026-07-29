"use client";

import { useActionState, useState } from "react";
import { CalendarX2, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { annulerSeanceAVenir } from "@/lib/actions/emargement";
import type { ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";

/** Une séance suivante du même créneau, proposée comme borne d'annulation. */
export type BorneSeance = { date: string; libelle: string; nombre: number };

/**
 * Annulation d'une séance par l'animateur, depuis son espace mobile.
 *
 * Un empêchement dure rarement une seule semaine : arrêt de travail, salle
 * fermée, congés. Proposer d'emblée « jusqu'au… » évite de rouvrir six fois le
 * même écran — et surtout d'envoyer six courriels aux mêmes agents.
 *
 * Les bornes proposées sont les séances réelles du créneau, pas un calendrier
 * libre : sur un téléphone, choisir une date sans séance n'a aucun sens.
 */
export function AnnulerSeanceCoach({
  token,
  seanceId,
  suivantes,
}: {
  token: string;
  seanceId: string;
  suivantes: BorneSeance[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    annulerSeanceAVenir,
    null,
  );
  const [ouvert, setOuvert] = useState(false);
  const [lot, setLot] = useState(false);
  const [jusqua, setJusqua] = useState(suivantes[0]?.date ?? "");

  if (state?.success) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
        <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" />
        <p className="mt-2 text-sm font-medium text-emerald-800">{state.success}</p>
        <Link
          href={`/emargement/${token}`}
          className="mt-4 inline-flex rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white"
        >
          Revenir à mes séances
        </Link>
      </div>
    );
  }

  // Replié tant qu'on ne le demande pas : l'écran d'une séance sert d'abord à
  // voir qui vient. L'annulation reste l'exception, elle n'a pas à occuper la
  // place ni à donner l'impression d'y pousser.
  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-medium text-slate-600 shadow-sm transition active:scale-[0.99]"
      >
        <CalendarX2 className="h-4 w-4 text-slate-400" /> Prévenir d&apos;une annulation
      </button>
    );
  }

  const retenues = lot
    ? (suivantes.find((s) => s.date === jusqua)?.nombre ?? 1)
    : 1;

  return (
    <form
      action={action}
      onSubmit={(e) => {
        const message =
          retenues > 1
            ? `Annuler ${retenues} séances et prévenir les inscrits ?`
            : "Annuler cette séance et prévenir les inscrits ?";
        if (!confirm(message)) e.preventDefault();
      }}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="seanceId" value={seanceId} />
      {lot && <input type="hidden" name="jusqua" value={jusqua} />}

      {state?.error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">
          Pourquoi cette séance n&apos;aura-t-elle pas lieu ?
        </span>
        <input
          name="motif"
          required
          maxLength={200}
          placeholder="Salle indisponible, arrêt de travail…"
          className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-base outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
        />
      </label>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">
          Jusqu&apos;à quand ?
        </legend>
        <div className="space-y-2">
          <label
            className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-sm transition ${
              lot ? "border-slate-200" : "border-brand-300 bg-brand-50/60"
            }`}
          >
            <input
              type="radio"
              name="portee"
              checked={!lot}
              onChange={() => setLot(false)}
              className="h-4 w-4"
            />
            Cette séance seulement
          </label>

          {suivantes.length > 0 && (
            <label
              className={`block rounded-xl border px-3.5 py-3 text-sm transition ${
                lot ? "border-brand-300 bg-brand-50/60" : "border-slate-200"
              }`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="portee"
                  checked={lot}
                  onChange={() => setLot(true)}
                  className="h-4 w-4"
                />
                Celle-ci et les suivantes, jusqu&apos;au…
              </span>
              {lot && (
                <select
                  value={jusqua}
                  onChange={(e) => setJusqua(e.target.value)}
                  className="mt-2.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-base outline-none focus:border-brand-500"
                >
                  {suivantes.map((s) => (
                    <option key={s.date} value={s.date}>
                      {s.libelle} — {s.nombre} séances
                    </option>
                  ))}
                </select>
              )}
            </label>
          )}
        </div>
      </fieldset>

      <p className="text-xs text-slate-500">
        Les agents inscrits recevront le motif par courriel — un seul message
        chacun, quel que soit le nombre de séances.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOuvert(false)}
          className="rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm font-medium text-slate-600"
        >
          Revenir
        </button>
        <SubmitButton
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3.5 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
          pendingLabel="Envoi…"
        >
          <CalendarX2 className="h-4 w-4" />
          {retenues > 1 ? `Annuler ${retenues} séances` : "Annuler cette séance"}
        </SubmitButton>
      </div>
    </form>
  );
}
