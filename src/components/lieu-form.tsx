"use client";

import { useActionState } from "react";
import { MapPin } from "lucide-react";
import { enregistrerLieu } from "@/lib/actions/lieux";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, Textarea, btnPrimary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export type LieuInitial = {
  id: string;
  nom: string;
  adresse: string | null;
  notes: string | null;
};

export function LieuForm({ initial }: { initial?: LieuInitial }) {
  const [state, action] = useActionState<ActionState, FormData>(enregistrerLieu, null);
  return (
    <form action={action} className="space-y-4" key={initial?.id ?? state?.success ?? "n"}>
      <Alert state={state} />
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom du lieu" required>
          <Input
            name="nom"
            defaultValue={initial?.nom}
            required
            placeholder="Gymnase municipal — salle 2"
          />
        </Field>
        <Field label="Adresse" hint="Utile aux agents qui ne connaissent pas l'équipement.">
          <Input
            name="adresse"
            defaultValue={initial?.adresse ?? ""}
            placeholder="12 rue des Sports"
          />
        </Field>
      </div>
      <Field label="Consignes d'accès" hint="Code de porte, vestiaires, matériel à prévoir.">
        <Textarea
          name="notes"
          defaultValue={initial?.notes ?? ""}
          placeholder="Entrée par la cour, badge nécessaire après 18 h."
        />
      </Field>
      <SubmitButton className={btnPrimary}>
        <MapPin className="h-4 w-4" />
        {initial ? "Enregistrer le lieu" : "Ajouter le lieu"}
      </SubmitButton>
    </form>
  );
}
