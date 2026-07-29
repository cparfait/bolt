"use client";

import { useActionState, useState } from "react";
import { Send, XCircle } from "lucide-react";
import {
  annulerSeanceEmargement,
  cloturerEmargement,
} from "@/lib/actions/emargement";
import type { ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";

/** Transmission de la feuille et déclaration de séance non tenue. */
export function ActionsSeance({
  token,
  seanceId,
}: {
  token: string;
  seanceId: string;
}) {
  const [etatCloture, actionCloture] = useActionState<ActionState, FormData>(
    cloturerEmargement,
    null,
  );
  const [etatAnnule, actionAnnule] = useActionState<ActionState, FormData>(
    annulerSeanceEmargement,
    null,
  );
  const [annulerOuvert, setAnnulerOuvert] = useState(false);

  return (
    <div id="transmettre" className="mt-6 space-y-3 scroll-mt-4">
      <form action={actionCloture} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="seanceId" value={seanceId} />
        {etatCloture?.error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {etatCloture.error}
          </p>
        )}
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-600">
            Un mot sur la séance ? (facultatif)
          </span>
          <textarea
            name="commentaire"
            rows={2}
            placeholder="Matériel manquant, incident, remarque…"
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
          />
        </label>
        <SubmitButton
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-4 text-base font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50"
          pendingLabel="Transmission…"
        >
          <Send className="h-4 w-4" /> Transmettre la feuille
        </SubmitButton>
      </form>

      {!annulerOuvert ? (
        <button
          type="button"
          onClick={() => setAnnulerOuvert(true)}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-500 transition active:scale-[0.99]"
        >
          La séance n&apos;a pas eu lieu
        </button>
      ) : (
        <form
          action={actionAnnule}
          className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"
        >
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="seanceId" value={seanceId} />
          {etatAnnule?.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {etatAnnule.error}
            </p>
          )}
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-amber-900">
              Pourquoi la séance n&apos;a-t-elle pas eu lieu ?
            </span>
            <input
              name="motif"
              required
              placeholder="Salle indisponible, animateur absent…"
              className="w-full rounded-xl border border-amber-300 bg-white px-3.5 py-3 text-sm outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-100"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAnnulerOuvert(false)}
              className="flex-1 rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm font-medium text-amber-800"
            >
              Annuler
            </button>
            <SubmitButton
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              pendingLabel="Envoi…"
            >
              <XCircle className="h-4 w-4" /> Confirmer
            </SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
