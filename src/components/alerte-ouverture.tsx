"use client";

import { useActionState } from "react";
import { Bell, BellOff } from "lucide-react";
import { basculerAlerteOuvertureAction } from "@/lib/actions/alertes-ouverture";
import type { ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";

/**
 * Sous « Inscriptions fermées » : un seul bouton, qui pose l'alerte ou la
 * retire selon l'état. L'état posé se lit comme une confirmation (« Vous
 * serez prévenu ») et non comme un second bouton d'action : le geste est
 * fait, on n'a rien d'autre à faire ici.
 */
export function AlerteOuverture({ creneauId, posee }: { creneauId: string; posee: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(
    basculerAlerteOuvertureAction,
    null,
  );
  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="creneauId" value={creneauId} />
      {state?.error && <p className="mb-1.5 text-xs text-red-600">{state.error}</p>}
      {posee ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
          <span className="flex items-center gap-1.5 font-medium">
            <Bell className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Vous serez prévenu à l&apos;ouverture
          </span>
          <SubmitButton
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 underline-offset-2 hover:underline"
            pendingLabel="…"
          >
            <BellOff className="h-3.5 w-3.5" aria-hidden="true" /> Ne plus me prévenir
          </SubmitButton>
        </div>
      ) : (
        <SubmitButton
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-sm font-medium text-brand-700 transition hover:bg-brand-50"
          pendingLabel="Enregistrement…"
        >
          <Bell className="h-4 w-4" aria-hidden="true" /> Me prévenir à l&apos;ouverture
        </SubmitButton>
      )}
    </form>
  );
}
