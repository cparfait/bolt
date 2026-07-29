"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/lib/actions/auth";
import { Alert, Field, Input, btnPrimary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, null);
  return (
    <form action={action} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <Alert state={state} />
      <Field label="Identifiant" required>
        <Input name="login" autoComplete="username" autoFocus required />
      </Field>
      <Field label="Mot de passe" required>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className={`${btnPrimary} w-full justify-center`} pendingLabel="Connexion…">
        Se connecter
      </SubmitButton>
    </form>
  );
}
