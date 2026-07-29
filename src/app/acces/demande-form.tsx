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
      <Field label="Adresse professionnelle" required>
        <Input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="prenom.nom@collectivite.fr"
          autoFocus
          required
        />
      </Field>
      <SubmitButton
        className={`${btnPrimary} w-full justify-center`}
        pendingLabel="Envoi…"
      >
        Recevoir mon lien de connexion
      </SubmitButton>
    </form>
  );
}
