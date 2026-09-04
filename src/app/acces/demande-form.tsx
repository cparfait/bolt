"use client";

import { useActionState } from "react";
import { demanderLienAction } from "@/lib/actions/auth";
import { Alert, Field, Input, btnPrimary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/actions/types";

export function DemandeLienForm() {
  const [state, action] = useActionState<ActionState, FormData>(
    demanderLienAction,
    null,
  );
  return (
    <form
      action={action}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <Alert state={state} />
      {/* Ni « professionnelle » ni « personnelle » : c'est l'adresse que le
          service des sports connaît. Beaucoup des agents visés — terrain,
          crèches, gardiennage — sont enregistrés avec une adresse personnelle,
          faute de boîte professionnelle qu'ils consultent. Promettre l'adresse
          professionnelle les envoyait saisir celle qui n'ouvre rien. */}
      <Field
        label="Votre adresse e-mail"
        hint="Celle à laquelle le service des sports vous écrit."
        required
      >
        <Input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="prenom.nom@exemple.fr"
          autoFocus
          required
        />
      </Field>
      <SubmitButton
        className={`${btnPrimary} w-full justify-center`}
        pendingLabel="Envoi…"
      >
        Recevoir mon lien
      </SubmitButton>

      <p className="text-xs text-slate-400">
        Vous recevez un lien valable 30 minutes. Aucun mot de passe ne vous est
        demandé.
      </p>
    </form>
  );
}
