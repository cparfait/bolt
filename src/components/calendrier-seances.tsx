"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CalendarX2, X } from "lucide-react";
import { annulerSeances } from "@/lib/actions/seances";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export type SeanceCalendrier = {
  id: string;
  heureDebut: string;
  heureFin: string;
  activite: string;
  couleur: string;
  lieu: string | null;
  inscrits: number;
  presents: number;
  statut: "PLANIFIEE" | "FAITE" | "ANNULEE";
  // Encore planifiée et à venir : sélectionnable pour annulation.
  annulable: boolean;
};

export type JourCalendrier = {
  iso: string; // « 2026-09-28 »
  numero: number; // quantième affiché dans la case
  horsMois: boolean; // jour de complément de grille (vue mois)
  aujourdHui: boolean;
  fermeture: string | null; // libellé de la période de fermeture, le cas échéant
  seances: SeanceCalendrier[];
};

const ENTETES = ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."];

/**
 * Grille calendaire des séances, à la manière d'un agenda.
 *
 * Une séance à venir se sélectionne d'un clic pour être annulée — en lot, avec
 * un seul motif et un seul courriel par inscrit. Une séance passée, émargée ou
 * déjà annulée n'a rien à sélectionner : le clic ouvre sa fiche.
 *
 * L'annulation plutôt que la suppression : une séance supprimée serait recréée
 * à la prochaine régénération du calendrier (modification du créneau, nouvelle
 * période de fermeture), tandis qu'une annulation est conservée et réversible.
 */
export function CalendrierSeances({
  vue,
  jours,
}: {
  vue: "mois" | "semaine";
  jours: JourCalendrier[];
}) {
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

  const toutes = jours.flatMap((j) => j.seances);
  const inscritsConcernes = toutes
    .filter((s) => selection.has(s.id))
    .reduce((n, s) => n + s.inscrits, 0);

  const infobulle = (s: SeanceCalendrier) =>
    [
      `${s.activite} — ${s.heureDebut}–${s.heureFin}`,
      s.lieu,
      s.statut === "ANNULEE"
        ? "Annulée"
        : s.statut === "FAITE"
          ? `Émargée — ${s.presents} présent${s.presents > 1 ? "s" : ""}`
          : `${s.inscrits} inscrit${s.inscrits > 1 ? "s" : ""}`,
    ]
      .filter(Boolean)
      .join("\n");

  /** Pastille d'une séance : bouton de sélection ou lien vers la fiche. */
  const chip = (s: SeanceCalendrier) => {
    const dense = vue === "mois";
    const contenu = dense ? (
      <>
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: s.couleur }}
          aria-hidden
        />
        <span className={`truncate ${s.statut === "ANNULEE" ? "line-through" : ""}`}>
          <span className="tabular-nums">{s.heureDebut}</span> {s.activite}
        </span>
      </>
    ) : (
      <span className="block min-w-0">
        <span
          className={`block truncate font-medium ${s.statut === "ANNULEE" ? "line-through" : ""}`}
        >
          {s.activite}
        </span>
        <span className="block tabular-nums text-slate-500">
          {s.heureDebut}–{s.heureFin}
        </span>
        {s.lieu && <span className="block truncate text-slate-400">{s.lieu}</span>}
        <span className="block text-slate-500">
          {s.statut === "ANNULEE"
            ? "Annulée"
            : s.statut === "FAITE"
              ? `${s.presents} présent${s.presents > 1 ? "s" : ""}`
              : `${s.inscrits} inscrit${s.inscrits > 1 ? "s" : ""}`}
        </span>
      </span>
    );

    const base = dense
      ? "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] leading-tight transition"
      : "block w-full rounded-lg border px-2 py-1.5 text-left text-xs leading-snug transition";
    const bordure = dense ? {} : { borderLeft: `3px solid ${s.couleur}` };

    if (s.annulable) {
      const choisie = selection.has(s.id);
      return (
        <button
          key={s.id}
          type="button"
          onClick={() => basculer(s.id)}
          title={infobulle(s)}
          aria-pressed={choisie}
          className={`${base} ${
            choisie
              ? "bg-red-100 text-red-800 ring-1 ring-inset ring-red-400"
              : dense
                ? "hover:bg-slate-100"
                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
          }`}
          style={bordure}
        >
          {contenu}
        </button>
      );
    }

    return (
      <Link
        key={s.id}
        href={`/seances/${s.id}`}
        title={infobulle(s)}
        className={`${base} ${
          s.statut === "ANNULEE" ? "text-red-400 opacity-70" : "text-slate-600"
        } ${dense ? "hover:bg-slate-100" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}
        style={bordure}
      >
        {contenu}
      </Link>
    );
  };

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

      <div className="overflow-x-auto">
        <div
          className={`grid grid-cols-7 overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 shadow-sm ${
            vue === "mois" ? "min-w-[640px] gap-px" : "min-w-[760px] gap-px"
          }`}
        >
          {ENTETES.map((e) => (
            <div
              key={e}
              className="bg-slate-50 px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              {e}
            </div>
          ))}
          {jours.map((j) => (
            <div
              key={j.iso}
              className={`space-y-1 p-1.5 ${vue === "mois" ? "min-h-24" : "min-h-48"} ${
                j.horsMois
                  ? "bg-slate-50/80"
                  : j.fermeture
                    ? "bg-amber-50/70"
                    : "bg-white"
              }`}
            >
              <div className="flex items-center justify-between gap-1 px-0.5">
                {j.fermeture ? (
                  <span
                    className="truncate text-[10px] font-medium text-amber-700"
                    title={j.fermeture}
                  >
                    {j.fermeture}
                  </span>
                ) : (
                  <span />
                )}
                <span
                  className={`text-xs tabular-nums ${
                    j.aujourdHui
                      ? "flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 font-semibold text-white"
                      : j.horsMois
                        ? "text-slate-300"
                        : "text-slate-500"
                  }`}
                >
                  {j.numero}
                </span>
              </div>
              {j.seances.map(chip)}
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Cliquez sur une séance à venir pour la sélectionner ; une séance passée,
        émargée ou annulée s&apos;ouvre dans sa fiche.
      </p>

      {selection.size > 0 && (
        <div className="sticky bottom-4 z-10 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
          {[...selection].map((id) => (
            <input key={id} type="hidden" name="seance" value={id} />
          ))}
          <div className="flex flex-wrap items-end gap-3">
            <Field
              label="Motif de l'annulation"
              required
              className="min-w-56 flex-1"
              hint="Repris tel quel dans le message envoyé aux agents."
            >
              <Input
                name="motif"
                required
                maxLength={200}
                placeholder="Vacances scolaires, gymnase indisponible…"
              />
            </Field>
            <label className="flex items-center gap-2 pb-5 text-sm">
              <input
                type="checkbox"
                name="prevenir"
                checked={prevenir}
                onChange={(e) => setPrevenir(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span>
                Prévenir les inscrits
                {inscritsConcernes > 0 && (
                  <span className="text-slate-400"> ({inscritsConcernes})</span>
                )}
              </span>
            </label>
            <div className="flex items-center gap-2 pb-1">
              <SubmitButton
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:opacity-50"
                pendingLabel="Annulation…"
              >
                <CalendarX2 className="h-4 w-4" />
                Annuler {selection.size} séance{selection.size > 1 ? "s" : ""}
              </SubmitButton>
              <button
                type="button"
                onClick={() => setSelection(new Set())}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-100"
              >
                <X className="h-4 w-4" /> Vider
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
