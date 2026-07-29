"use client";

import { useActionState } from "react";
import { LogOut, Plus } from "lucide-react";
import { desisterAction, inscrireAction } from "@/lib/actions/inscriptions";
import type { ActionState } from "@/lib/actions/types";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/** Bouton d'inscription d'un agent à un créneau du catalogue. */
export function InscrireForm({
  creneauId,
  complet,
}: {
  creneauId: string;
  complet: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(inscrireAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="creneauId" value={creneauId} />
      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      )}
      {state?.success && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {state.success}
        </p>
      )}
      <SubmitButton
        className={
          complet
            ? "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-sm font-medium text-blue-700 transition hover:bg-blue-50 disabled:opacity-50"
            : "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
        }
        pendingLabel="Envoi…"
      >
        <Plus className="h-4 w-4" />
        {complet ? "Rejoindre la liste d'attente" : "M'inscrire"}
      </SubmitButton>
    </form>
  );
}

/** Désinscription par l'agent lui-même. */
export function DesinscrireForm({ id }: { id: string }) {
  const [state, action] = useActionState<ActionState, FormData>(desisterAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Alert state={state?.error ? state : null} />
      <SubmitButton
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        pendingLabel="…"
      >
        <LogOut className="h-3.5 w-3.5" /> Me désinscrire
      </SubmitButton>
    </form>
  );
}
