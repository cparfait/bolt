"use client";

import { useActionState, useState } from "react";
import { CalendarX2 } from "lucide-react";
import { annulerSeances } from "@/lib/actions/seances";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export type SeanceAnnulable = {
  id: string;
  jour: string; // « mer. 29/07 »
  horaire: string; // « 12:15–13:15 »
  activite: string;
  couleur: string;
  lieu: string | null;
  inscrits: number;
};

/**
 * Sélection des séances à annuler.
 *
 * Rien n'est coché au départ : la liste peut compter plusieurs dizaines de
 * séances, et un envoi de courriels ne se rattrape pas. Le bouton rappelle donc
 * toujours le nombre exact retenu, et une confirmation récapitule avant l'envoi.
 */
export function AnnulationGroupee({ seances }: { seances: SeanceAnnulable[] }) {
  const [state, action] = useActionState<ActionState, FormData>(annulerSeances, null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [prevenir, setPrevenir] = useState(true);

  const basculer = (id: string) =>
    setSelection((s) => {
      const copie = new Set(s);
      if (copie.has(id)) copie.delete(id);
      else copie.add(id);
      return copie;
    });

  const toutes = selection.size === seances.length && seances.length > 0;
  const inscritsConcernes = seances
    .filter((s) => selection.has(s.id))
    .reduce((n, s) => n + s.inscrits, 0);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        const n = selection.size;
        const message =
          `Annuler ${n} séance${n > 1 ? "s" : ""} ?` +
          (prevenir
            ? `\n\nUn courriel partira vers les inscrits concernés.`
            : `\n\nAucun courriel ne sera envoyé.`);
        if (!confirm(message)) e.preventDefault();
        else setSelection(new Set());
      }}
      className="space-y-4"
    >
      <Alert state={state} />

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
          <label className="flex items-center gap-2.5 text-sm font-medium text-slate-600">
            <input
              type="checkbox"
              checked={toutes}
              onChange={() =>
                setSelection(toutes ? new Set() : new Set(seances.map((s) => s.id)))
              }
              className="h-4 w-4 rounded border-slate-300"
            />
            Tout sélectionner
          </label>
          <span className="text-xs tabular-nums text-slate-500">
            {selection.size} / {seances.length}
          </span>
        </div>

        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
          {seances.map((s) => (
            <li key={s.id}>
              <label
                className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition ${
                  selection.has(s.id) ? "bg-red-50/60" : "hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  name="seance"
                  value={s.id}
                  checked={selection.has(s.id)}
                  onChange={() => basculer(s.id)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span
                  className="h-7 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: s.couleur }}
                  aria-hidden
                />
                <span className="w-24 shrink-0 tabular-nums text-slate-500">{s.jour}</span>
                <span className="w-28 shrink-0 tabular-nums text-slate-500">
                  {s.horaire}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.activite}</span>
                  {s.lieu && (
                    <span className="block truncate text-xs text-slate-400">{s.lieu}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">
                  {s.inscrits} {s.inscrits > 1 ? "inscrits" : "inscrit"}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <Field
        label="Motif de l'annulation"
        required
        hint="Repris tel quel dans le message envoyé aux agents."
      >
        <Input
          name="motif"
          required
          maxLength={200}
          placeholder="Piscine fermée pour maintenance, animateur en congés…"
        />
      </Field>

      <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-sm">
        <input
          type="checkbox"
          name="prevenir"
          checked={prevenir}
          onChange={(e) => setPrevenir(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>
          <span className="block font-medium">Prévenir les inscrits par courriel</span>
          <span className="block text-xs text-slate-500">
            Un seul message par agent, quel que soit le nombre de séances qui le
            concernent.
            {selection.size > 0 &&
              ` ${inscritsConcernes} place${inscritsConcernes > 1 ? "s" : ""} concernée${inscritsConcernes > 1 ? "s" : ""} au total.`}
          </span>
        </span>
      </label>

      <SubmitButton
        className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:opacity-50"
        pendingLabel="Annulation…"
        disabled={selection.size === 0}
      >
        <CalendarX2 className="h-4 w-4" />
        {selection.size === 0
          ? "Sélectionnez des séances"
          : `Annuler ${selection.size} séance${selection.size > 1 ? "s" : ""}`}
      </SubmitButton>
    </form>
  );
}
