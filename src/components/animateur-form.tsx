"use client";

import { useActionState, useState } from "react";
import type { CoachAcces } from "@prisma/client";
import { enregistrerAnimateur } from "@/lib/actions/animateurs";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, Textarea, btnPrimary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { COACH_ACCES_AIDE, COACH_ACCES_LABELS } from "@/lib/constants";

export type AnimateurInitial = {
  id: string;
  nom: string;
  prenom: string;
  email: string | null;
  telephone: string | null;
  organisme: string | null;
  acces: CoachAcces;
  notes: string | null;
  login: string | null;
};

const MODES: CoachAcces[] = ["LIEN", "AD", "LOCAL"];

export function AnimateurForm({ initial }: { initial?: AnimateurInitial }) {
  const [state, action] = useActionState<ActionState, FormData>(
    enregistrerAnimateur,
    null,
  );
  const [acces, setAcces] = useState<CoachAcces>(initial?.acces ?? "LIEN");

  return (
    <form action={action} className="space-y-4">
      <Alert state={state} />
      {initial && <input type="hidden" name="id" value={initial.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prénom" required>
          <Input name="prenom" defaultValue={initial?.prenom} required />
        </Field>
        <Field label="Nom" required>
          <Input name="nom" defaultValue={initial?.nom} required />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="E-mail" hint="Pour lui transmettre son accès.">
          <Input name="email" type="email" defaultValue={initial?.email ?? ""} />
        </Field>
        <Field label="Téléphone">
          <Input name="telephone" defaultValue={initial?.telephone ?? ""} />
        </Field>
      </div>

      <Field label="Organisme" hint="Association ou prestataire employeur, le cas échéant.">
        <Input name="organisme" defaultValue={initial?.organisme ?? ""} />
      </Field>

      <Field label="Mode d'accès" required>
        <div className="space-y-2">
          {MODES.map((m) => (
            <label
              key={m}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                acces === m
                  ? "border-indigo-300 bg-indigo-50/50"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="acces"
                value={m}
                checked={acces === m}
                onChange={() => setAcces(m)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="block text-sm font-medium">{COACH_ACCES_LABELS[m]}</span>
                <span className="block text-xs text-slate-500">{COACH_ACCES_AIDE[m]}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      {acces !== "LIEN" && (
        <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4 sm:grid-cols-2">
          <Field
            label={acces === "AD" ? "Identifiant Windows" : "Identifiant local"}
            required
            hint={
              acces === "AD"
                ? "sAMAccountName de l'animateur dans l'annuaire."
                : "Identifiant créé dans Bolt, indépendant de l'annuaire."
            }
          >
            <Input name="login" defaultValue={initial?.login ?? ""} autoComplete="off" />
          </Field>
          {acces === "LOCAL" && (
            <Field
              label="Mot de passe"
              hint={initial ? "Laisser vide pour ne pas le changer." : "8 caractères minimum."}
            >
              <Input name="motDePasse" type="password" autoComplete="new-password" />
            </Field>
          )}
        </div>
      )}

      <Field label="Notes internes">
        <Textarea name="notes" defaultValue={initial?.notes ?? ""} rows={2} />
      </Field>

      <SubmitButton className={btnPrimary}>
        {initial ? "Enregistrer" : "Créer l'animateur"}
      </SubmitButton>
    </form>
  );
}
