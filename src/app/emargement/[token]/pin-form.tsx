"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { validerPinAction } from "@/lib/actions/emargement";
import type { ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";

/**
 * Second facteur de l'accès distant. Le champ est en `inputMode="numeric"` :
 * l'animateur obtient le pavé numérique, pas le clavier complet.
 */
export function PinForm({ token, prenom }: { token: string; prenom: string }) {
  const [state, action] = useActionState<ActionState, FormData>(validerPinAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state?.error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-slate-600">
          Bonjour {prenom}, saisissez votre code à 6 chiffres
        </span>
        <input
          name="pin"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          autoFocus
          placeholder="••••••"
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-4 text-center text-2xl tracking-[0.4em] tabular-nums outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
        />
      </label>
      <SubmitButton
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
        pendingLabel="Vérification…"
      >
        <KeyRound className="h-4 w-4" /> Accéder à mes séances
      </SubmitButton>
      <p className="text-center text-xs text-slate-400">
        Le code vous est demandé une fois toutes les 8 heures sur cet appareil.
      </p>
    </form>
  );
}
