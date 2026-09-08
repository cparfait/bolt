"use client";

import { useActionState } from "react";
import { CheckCircle2, CalendarX2, Undo2 } from "lucide-react";
import { basculerAbsenceParLien } from "@/lib/actions/liens-courriel";
import type { ActionState } from "@/lib/actions/types";
import { btnDanger, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/**
 * Le bouton, et son retour en arrière.
 *
 * Un seul geste par écran : la personne vient de cliquer dans un courriel, sur
 * un téléphone, pour dire une chose simple. L'état affiché est celui que
 * l'action vient de renvoyer, et à défaut celui trouvé en base — sans quoi la
 * page revenue de l'action montrerait encore l'état d'avant.
 */
export function BoutonAbsence({
  seanceId,
  userId,
  signature,
  absentAuDepart,
}: {
  seanceId: string;
  userId: string;
  signature: string;
  absentAuDepart: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    basculerAbsenceParLien,
    null,
  );

  const absent = state?.success ? state.success === "absence" : absentAuDepart;

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="seanceId" value={seanceId} />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="signature" value={signature} />

      {state?.error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {state.error}
        </p>
      )}

      {absent ? (
        <>
          <p className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            Votre absence est signalée. L&apos;animateur ne vous attendra pas.
          </p>
          <SubmitButton className={`${btnSecondary} w-full justify-center`} pendingLabel="…">
            <Undo2 className="h-4 w-4" />
            Finalement, je viens
          </SubmitButton>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-500">
            Un empêchement ? Prévenez d&apos;un clic : votre place profitera à un
            collègue en liste d&apos;attente, et l&apos;animateur ne vous attendra
            pas.
          </p>
          <SubmitButton className={`${btnDanger} w-full justify-center`} pendingLabel="…">
            <CalendarX2 className="h-4 w-4" />
            Je ne pourrai pas venir
          </SubmitButton>
        </>
      )}
    </form>
  );
}
