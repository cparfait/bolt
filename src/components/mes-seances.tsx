"use client";

import { useActionState, useState, useTransition } from "react";
import { CalendarX2, Check, Undo2 } from "lucide-react";
import { annulerAbsence, declarerAbsence } from "@/lib/actions/absences";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Card, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { fmtDateLongue } from "@/lib/dates";

export type SeanceAgent = {
  id: string;
  date: Date;
  heureDebut: string;
  heureFin: string;
  lieu: string | null;
  activite: string;
  couleur: string;
  absent: boolean;
  motif: string | null;
  annulee: boolean;
  motifAnnulation: string | null;
};

/**
 * Prochaines séances de l'agent, avec déclaration d'absence.
 *
 * Le formulaire de motif ne s'ouvre qu'au clic : afficher un champ libre sur
 * chaque ligne encombrerait la liste, alors que la note est facultative et
 * rarement utilisée.
 */
/** Clé de comparaison des jours : les dates sont à minuit UTC. */
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function MesSeances({ seances }: { seances: SeanceAgent[] }) {
  const [state, action] = useActionState<ActionState, FormData>(declarerAbsence, null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  // Borne d'absence prolongée : une absence tient rarement en une séance —
  // congés, arrêt, formation. Null = cette séance seulement.
  const [jusqua, setJusqua] = useState<string | null>(null);
  const [, start] = useTransition();

  const declarables = seances.filter((s) => !s.annulee && !s.absent);
  const annoncees = seances.filter((s) => s.absent && !s.annulee);
  const ouvrir = (id: string | null) => {
    setOuvert(id);
    setJusqua(null);
  };

  if (seances.length === 0) {
    return (
      <Card title="Mes prochaines séances">
        <EmptyState
          title="Aucune séance à venir"
          hint="Inscrivez-vous à une activité depuis le catalogue."
        />
      </Card>
    );
  }

  return (
    <Card title="Mes prochaines séances">
      <div className="mb-3">
        <Alert state={state} />
      </div>
      <ul className="divide-y divide-slate-100">
        {seances.map((s) => (
          <li key={s.id} className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: s.couleur }}
                  />
                  <span className={s.annulee ? "text-slate-400 line-through" : ""}>
                    {s.activite}
                  </span>
                </p>
                <p
                  className={`text-xs text-slate-400 ${s.annulee ? "line-through" : ""}`}
                >
                  <span className="first-letter:uppercase">{fmtDateLongue(s.date)}</span> ·{" "}
                  {s.heureDebut}–{s.heureFin}
                  {s.lieu ? ` · ${s.lieu}` : ""}
                </p>
                {s.annulee && (
                  <p className="mt-1 text-xs font-medium text-red-600">
                    Séance annulée
                    {s.motifAnnulation ? ` — ${s.motifAnnulation}` : ""}
                  </p>
                )}
                {s.absent && !s.annulee && (
                  <p className="mt-1 text-xs font-medium text-amber-700">
                    Vous avez signalé votre absence
                    {s.motif ? ` — « ${s.motif} »` : ""}
                  </p>
                )}
              </div>

              {s.annulee ? null : s.absent ? (
                <button
                  type="button"
                  onClick={() => start(async () => void (await annulerAbsence([s.id])))}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  <Undo2 className="h-3.5 w-3.5" /> Finalement je viens
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => ouvrir(ouvert === s.id ? null : s.id)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-50"
                >
                  <CalendarX2 className="h-3.5 w-3.5" />
                  {ouvert === s.id ? "Fermer" : "Je serai absent"}
                </button>
              )}
            </div>

            {ouvert === s.id &&
              !s.absent &&
              !s.annulee &&
              (() => {
                // Séances couvertes par la déclaration : celle-ci, plus les
                // suivantes jusqu'à la borne choisie. Envoyées explicitement,
                // pour que le nombre annoncé soit exactement celui traité.
                const suivantes = declarables.filter((x) => x.date > s.date);
                const couvertes = jusqua
                  ? declarables.filter(
                      (x) => iso(x.date) >= iso(s.date) && iso(x.date) <= jusqua,
                    )
                  : [s];
                return (
                  <form
                    action={action}
                    onSubmit={() => ouvrir(null)}
                    className="mt-3 space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3"
                  >
                    {couvertes.map((x) => (
                      <input key={x.id} type="hidden" name="seanceId" value={x.id} />
                    ))}

                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-amber-900">
                        Un mot pour l&apos;animateur ? (facultatif)
                      </span>
                      <input
                        name="motif"
                        maxLength={200}
                        placeholder="Réunion, congés, blessure…"
                        className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                      />
                    </label>

                    {/* Un empêchement dure rarement une séance : congés, arrêt,
                        formation. Sans cette option, on oublie une date sur deux
                        et l'animateur attend quelqu'un qui ne viendra pas. */}
                    {suivantes.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-sm text-amber-900">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            checked={jusqua === null}
                            onChange={() => setJusqua(null)}
                            className="h-4 w-4"
                          />
                          Cette séance seulement
                        </label>
                        <label className="flex flex-wrap items-center gap-2">
                          <input
                            type="radio"
                            checked={jusqua !== null}
                            onChange={() => setJusqua(iso(suivantes[0].date))}
                            className="h-4 w-4"
                          />
                          Jusqu&apos;au
                          <select
                            value={jusqua ?? ""}
                            onChange={(e) => setJusqua(e.target.value)}
                            disabled={jusqua === null}
                            className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500 disabled:opacity-50"
                          >
                            {suivantes.map((x) => (
                              <option key={x.id} value={iso(x.date)}>
                                {fmtDateLongue(x.date)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-amber-800">
                        {couvertes.length > 1
                          ? `${couvertes.length} séances seront signalées.`
                          : "1 séance sera signalée."}
                      </span>
                      <SubmitButton
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:opacity-50"
                        pendingLabel="Envoi…"
                      >
                        <Check className="h-4 w-4" /> Confirmer
                      </SubmitButton>
                    </div>
                  </form>
                );
              })()}
          </li>
        ))}
      </ul>

      {/* Se déclarer absent trois semaines puis voir ses congés annulés arrive :
          on doit pouvoir tout reprendre d'un geste, pas séance par séance. */}
      {annoncees.length > 1 && (
        <button
          type="button"
          onClick={() =>
            start(async () => void (await annulerAbsence(annoncees.map((s) => s.id))))
          }
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <Undo2 className="h-3.5 w-3.5" /> Finalement je viens à mes{" "}
          {annoncees.length} séances signalées
        </button>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Prévenir permet à l&apos;animateur de ne pas vous attendre, et au service
        des sports de distinguer un empêchement ponctuel d&apos;un abandon.
      </p>
    </Card>
  );
}
