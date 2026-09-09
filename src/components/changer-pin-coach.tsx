"use client";

import { useActionState, useState } from "react";
import { KeyRound } from "lucide-react";
import { changerPinAction } from "@/lib/actions/emargement";
import type { ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";

/**
 * Changement du code à 6 chiffres par l'animateur.
 *
 * Le code initial est tiré au hasard : impossible à retenir, il finit noté sur
 * un papier ou dans les notes du téléphone — moins sûr, en pratique, qu'un code
 * choisi. Les combinaisons trop devinables sont refusées côté serveur ; la
 * règle est annoncée ici pour éviter de les proposer.
 */
export function ChangerPinCoach({ token }: { token: string }) {
  const [state, action] = useActionState<ActionState, FormData>(changerPinAction, null);
  const [ouvert, setOuvert] = useState(false);
  // Le nouveau code se tape deux fois : masqué à l'écran, une faute de frappe
  // ne se voit pas, et un code enregistré de travers ferme l'accès jusqu'à ce
  // que le service des sports en régénère un. La comparaison se fait ici, avant
  // envoi ; le serveur ne connaît que le code retenu.
  const [nouveau, setNouveau] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const discordant = confirmation.length > 0 && confirmation !== nouveau;

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-500 transition active:scale-[0.99]"
      >
        <KeyRound className="h-4 w-4 text-slate-400" /> Changer mon code
      </button>
    );
  }

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (nouveau !== confirmation) e.preventDefault();
      }}
      className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <input type="hidden" name="token" value={token} />

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

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Code actuel</span>
        <input
          name="ancien"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          maxLength={6}
          required
          placeholder="······"
          className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-center text-lg tracking-[0.4em] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Nouveau code</span>
        <input
          name="nouveau"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          required
          placeholder="······"
          value={nouveau}
          onChange={(e) => setNouveau(e.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-center text-lg tracking-[0.4em] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">
          Confirmer le nouveau code
        </span>
        {/* Pas de `name` : la confirmation ne sert qu'ici. */}
        <input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          required
          placeholder="······"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          aria-invalid={discordant}
          aria-describedby={discordant ? "pin-discordant" : undefined}
          className={`w-full rounded-xl border bg-white px-3.5 py-3 text-center text-lg tracking-[0.4em] outline-none focus:ring-4 ${
            discordant
              ? "border-red-300 focus:border-red-500 focus:ring-red-100"
              : "border-slate-300 focus:border-brand-500 focus:ring-brand-100"
          }`}
        />
        {discordant && (
          <span id="pin-discordant" className="mt-1 block text-xs text-red-600">
            Les deux codes ne correspondent pas.
          </span>
        )}
      </label>

      <p className="text-xs text-slate-500">
        Six chiffres. Ni six fois le même (000000), ni des chiffres qui se
        suivent (123456), ni un motif répété (121212).
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOuvert(false)}
          className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-600"
        >
          Fermer
        </button>
        <SubmitButton
          disabled={nouveau.length === 0 || nouveau !== confirmation}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
          pendingLabel="Enregistrement…"
        >
          <KeyRound className="h-4 w-4" /> Enregistrer le code
        </SubmitButton>
      </div>
    </form>
  );
}
