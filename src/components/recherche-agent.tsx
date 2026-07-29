"use client";

import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { inscrireAgentAction } from "@/lib/actions/inscriptions";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Select, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ChampAgent } from "@/components/champ-agent";

/** Inscription d'un agent à un créneau par le service des sports. */
export function RechercheAgent({
  creneaux,
}: {
  creneaux: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    inscrireAgentAction,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <Alert state={state} />
      {/* La clé remonte le champ — donc le vide — après chaque succès. */}
      <ChampAgent key={state?.success ?? "initial"} />

      <Field label="Créneau" required>
        <Select name="creneauId" required defaultValue="">
          <option value="">— Choisir —</option>
          {creneaux.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>

      <SubmitButton className={btnSecondary} pendingLabel="Inscription…">
        <UserPlus className="h-4 w-4" /> Inscrire
      </SubmitButton>
    </form>
  );
}
