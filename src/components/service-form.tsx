"use client";

import { useActionState } from "react";
import { Building2, DownloadCloud } from "lucide-react";
import {
  enregistrerService,
  importerServicesAnnuaire,
} from "@/lib/actions/services";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, btnPrimary, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export type ServiceInitial = { id: string; nom: string };

export function ServiceForm({ initial }: { initial?: ServiceInitial }) {
  const [state, action] = useActionState<ActionState, FormData>(
    enregistrerService,
    null,
  );
  return (
    <form action={action} className="space-y-4" key={initial?.id ?? state?.success ?? "n"}>
      <Alert state={state} />
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <Field
        label="Nom du service"
        hint="Tel qu'il doit apparaître sur le bon d'inscription."
        required
      >
        <Input
          name="nom"
          defaultValue={initial?.nom}
          required
          maxLength={120}
          placeholder="Services techniques"
        />
      </Field>
      <SubmitButton className={btnPrimary}>
        <Building2 className="h-4 w-4" />
        {initial ? "Enregistrer le service" : "Ajouter le service"}
      </SubmitButton>
    </form>
  );
}

/**
 * Reprise des services déjà portés par l'annuaire.
 *
 * Sans elle, un référentiel vide se remplit à la main alors que l'AD contient
 * déjà la liste réelle — recopiée, elle le serait avec des écarts, ce qui est
 * exactement le défaut que ce référentiel corrige.
 */
export function ImportServicesAnnuaire() {
  const [state, action] = useActionState<ActionState, FormData>(
    importerServicesAnnuaire,
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <SubmitButton className={btnSecondary} pendingLabel="Import…">
        <DownloadCloud className="h-4 w-4" />
        Reprendre les services de l&apos;annuaire
      </SubmitButton>
      <p className="text-xs text-slate-500">
        Ajoute les services portés par les comptes de l&apos;annuaire
        (attribut <code>department</code>) qui ne figurent pas déjà dans la
        liste. N&apos;en retire aucun, et ne crée pas de doublon : vous pouvez le
        relancer après chaque synchronisation.
      </p>
    </form>
  );
}
