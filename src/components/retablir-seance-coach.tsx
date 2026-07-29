"use client";

import { useActionState } from "react";
import { RotateCcw } from "lucide-react";
import { retablirSeanceAVenir } from "@/lib/actions/emargement";
import type { ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";

/**
 * Retour en arrière sur une annulation, côté animateur.
 *
 * L'empêchement se lève parfois — remplaçant trouvé, salle rendue. Sans ce
 * bouton, il fallait appeler le service des sports, et la séance restait
 * affichée « annulée » aux inscrits entre-temps.
 */
export function RetablirSeanceCoach({
  token,
  seanceId,
}: {
  token: string;
  seanceId: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    retablirSeanceAVenir,
    null,
  );

  if (state?.success) {
    return (
      <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm text-emerald-800">
        {state.success}
      </p>
    );
  }

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Rétablir cette séance et prévenir les inscrits ?")) {
          e.preventDefault();
        }
      }}
      className="space-y-2"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="seanceId" value={seanceId} />
      {state?.error && (
        <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <SubmitButton
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-medium text-slate-600 shadow-sm transition active:scale-[0.99] disabled:opacity-50"
        pendingLabel="Rétablissement…"
      >
        <RotateCcw className="h-4 w-4 text-slate-400" /> Finalement, elle aura lieu
      </SubmitButton>
    </form>
  );
}
