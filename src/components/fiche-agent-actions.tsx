"use client";

import { useActionState, useTransition } from "react";
import { CalendarX2, Undo2, UserPlus } from "lucide-react";
import { inscrireAgentAction } from "@/lib/actions/inscriptions";
import {
  annulerAbsencePourAgent,
  declarerAbsencePourAgent,
} from "@/lib/actions/absences";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, Select, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/**
 * Inscription d'un agent depuis sa fiche : l'agent est déjà identifié, on ne
 * choisit donc que le créneau — contrairement à la page des inscriptions, où
 * il faut d'abord le chercher.
 */
export function InscrireDepuisFiche({
  login,
  creneaux,
}: {
  login: string;
  creneaux: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    inscrireAgentAction,
    null,
  );

  if (creneaux.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Cet agent est déjà positionné sur tous les créneaux de la saison.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <input type="hidden" name="login" value={login} />
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

/**
 * Déclaration d'absence pour le compte de l'agent : tout le monde ne passera
 * pas par l'application, beaucoup préviendront par téléphone.
 */
export function AbsencePourAgent({
  userId,
  seances,
}: {
  userId: string;
  seances: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    declarerAbsencePourAgent,
    null,
  );

  if (seances.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Aucune séance à venir sur laquelle signaler une absence. Vérifiez ses
        inscriptions.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <input type="hidden" name="userId" value={userId} />
      <Field label="Séance" required>
        <Select name="seanceId" required defaultValue="">
          <option value="">— Choisir —</option>
          {seances.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Motif" hint="Facultatif — visible par l'animateur.">
        <Input name="motif" maxLength={200} placeholder="Congés, réunion, blessure…" />
      </Field>
      <SubmitButton className={btnSecondary} pendingLabel="Enregistrement…">
        <CalendarX2 className="h-4 w-4" /> Signaler l&apos;absence
      </SubmitButton>
    </form>
  );
}

/** Retrait d'une absence annoncée. */
export function RetirerAbsence({
  seanceId,
  userId,
}: {
  seanceId: string;
  userId: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await annulerAbsencePourAgent(seanceId, userId)))}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
    >
      <Undo2 className="h-3.5 w-3.5" /> Retirer
    </button>
  );
}
