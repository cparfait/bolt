"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Info, UserMinus } from "lucide-react";
import { rendreSaPlaceParLien } from "@/lib/actions/liens-courriel";
import type { ActionState } from "@/lib/actions/types";
import { btnDanger, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/**
 * Rendre sa place, en deux temps.
 *
 * Le geste ne se défait pas — la place repart au suivant de la file dans la
 * seconde —, et il est atteint depuis un courriel, sur un téléphone, d'un
 * pouce. Une confirmation intercalée coûte un clic à qui le veut vraiment, et
 * évite à l'autre de perdre une place qu'il attendait depuis la rentrée.
 */
export function BoutonPlace({
  inscriptionId,
  signature,
  activite,
  occupee,
}: {
  inscriptionId: string;
  signature: string;
  activite: string;
  /** L'inscription tient-elle encore une place ? Faux : il n'y a rien à rendre. */
  occupee: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    rendreSaPlaceParLien,
    null,
  );
  const [confirme, setConfirme] = useState(false);

  if (state?.success) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
        <p className="flex items-start gap-2 font-medium">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          Votre place de {activite} est libérée.
        </p>
        <p className="mt-1">
          Elle vient d&apos;être proposée à la personne suivante sur la liste
          d&apos;attente. Vous pouvez vous réinscrire à tout moment depuis
          l&apos;application — vous repasserez par la file si le créneau est de
          nouveau complet.
        </p>
      </div>
    );
  }

  if (!occupee) {
    return (
      <p className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        Vous n&apos;occupez plus de place sur ce créneau — elle a déjà été rendue,
        ou votre inscription a changé depuis l&apos;envoi du message.
      </p>
    );
  }

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="inscriptionId" value={inscriptionId} />
      <input type="hidden" name="signature" value={signature} />

      {state?.error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <p className="text-sm text-slate-500">
        Une place s&apos;est libérée et vous a été attribuée. Si elle ne vous
        convient plus, rendez-la : elle repartira aussitôt à la personne suivante
        sur la liste d&apos;attente.
      </p>

      {confirme ? (
        <>
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            Cette place sera immédiatement proposée à quelqu&apos;un d&apos;autre.
            Vous ne pourrez pas la reprendre.
          </p>
          <SubmitButton className={`${btnDanger} w-full justify-center`} pendingLabel="…">
            <UserMinus className="h-4 w-4" />
            Confirmer : je laisse ma place
          </SubmitButton>
          <button
            type="button"
            className={`${btnSecondary} w-full justify-center`}
            onClick={() => setConfirme(false)}
          >
            Annuler, je garde ma place
          </button>
        </>
      ) : (
        <button
          type="button"
          className={`${btnDanger} w-full justify-center`}
          onClick={() => setConfirme(true)}
        >
          <UserMinus className="h-4 w-4" />
          Je ne veux plus cette place
        </button>
      )}
    </form>
  );
}
