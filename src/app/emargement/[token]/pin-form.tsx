"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { validerPinAction } from "@/lib/actions/emargement";
import type { ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";

/**
 * Second facteur de l'accès distant. Le champ est en `inputMode="numeric"` :
 * l'animateur obtient le pavé numérique, pas le clavier complet.
 *
 * Masqué par défaut : le code se tape en gymnase, devant les agents qui
 * attendent la feuille, et un code lu par-dessus l'épaule ouvre l'émargement
 * à n'importe qui. Un bouton le dévoile pour qui veut vérifier sa saisie.
 *
 * Aucun prénom ici : le jeton seul ne doit rien révéler de l'animateur, ce
 * serait donner à qui trouve le lien de quoi savoir à qui il appartient.
 */
export function PinForm({ token }: { token: string }) {
  const [state, action] = useActionState<ActionState, FormData>(validerPinAction, null);
  const [visible, setVisible] = useState(false);
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
          Entrez votre code à 6 chiffres
        </span>
        <span className="relative block">
          <input
            name="pin"
            type={visible ? "text" : "password"}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            autoFocus
            placeholder="••••••"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-4 pr-14 text-center text-2xl tracking-[0.4em] tabular-nums outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Masquer le code" : "Afficher le code"}
            title={visible ? "Masquer le code" : "Afficher le code"}
            aria-pressed={visible}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-slate-400 transition hover:text-slate-600"
          >
            {visible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </span>
      </label>
      <SubmitButton
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-brand-500 disabled:opacity-50"
        pendingLabel="Vérification…"
      >
        <KeyRound className="h-4 w-4" /> Accéder à mes séances
      </SubmitButton>
      <p className="text-center text-xs text-slate-500">
        Le code vous est demandé une fois toutes les 8 heures sur cet appareil.
      </p>
    </form>
  );
}
