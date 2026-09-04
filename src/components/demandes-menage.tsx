"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  refuserEnAttenteAction,
  supprimerRefuseesAction,
} from "@/lib/actions/demandes";
import { Alert, Input, btnDanger, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/actions/types";

/**
 * Traitement en masse d'une vague de demandes.
 *
 * Le pendant des compteurs anti-abus : ceux-ci bornent ce qui entre, ceci
 * permet d'en sortir. Sans ces deux boutons, une vague de dépôts automatisés
 * laisserait le service devant des centaines de fiches à traiter une par une —
 * la prévention tenait, la remise en état non.
 *
 * Volontairement discret, replié derrière un lien : ce n'est pas le geste
 * courant, et un bouton « tout refuser » à côté de chaque fiche finirait par
 * être cliqué un jour de fatigue.
 */
export function DemandesMenage({
  enAttente,
  refusees,
  estAdmin,
}: {
  enAttente: number;
  refusees: number;
  estAdmin: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [refus, actionRefus] = useActionState<ActionState, FormData>(
    refuserEnAttenteAction,
    null,
  );
  const [suppr, actionSuppr] = useActionState<ActionState, FormData>(
    supprimerRefuseesAction,
    null,
  );

  if (enAttente === 0 && refusees === 0) return null;

  if (!ouvert) {
    return (
      <div className="mt-8 text-right">
        <button
          type="button"
          onClick={() => setOuvert(true)}
          className="text-xs text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
        >
          Traiter en masse
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Traitement en masse
        </h2>
        <button
          type="button"
          onClick={() => setOuvert(false)}
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          Fermer
        </button>
      </div>

      <Alert state={refus ?? suppr} />

      {enAttente > 0 && (
        <form
          action={actionRefus}
          className="space-y-2 border-t border-slate-100 pt-4"
          onSubmit={(e) => {
            if (
              !window.confirm(
                `Refuser les ${enAttente} demandes en attente ? Aucun courriel ne part. Une personne dont la demande était légitime pourra la redéposer.`,
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <p className="text-sm text-slate-600">
            Refuser les <strong>{enAttente}</strong> demandes en attente.
          </p>
          <Input name="motif" placeholder="Motif (interne)" maxLength={200} />
          <SubmitButton className={btnSecondary} pendingLabel="Refus…">
            Tout refuser
          </SubmitButton>
        </form>
      )}

      {refusees > 0 && estAdmin && (
        <form
          action={actionSuppr}
          className="space-y-2 border-t border-slate-100 pt-4"
          onSubmit={(e) => {
            if (
              !window.confirm(
                `Supprimer définitivement les ${refusees} demandes refusées ? Cette action est irréversible.`,
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="confirmation" value="supprimer" />
          <p className="text-sm text-slate-600">
            Supprimer définitivement les <strong>{refusees}</strong> demandes
            refusées. Les demandes validées sont conservées : elles documentent la
            création d&apos;un compte.
          </p>
          <SubmitButton className={btnDanger} pendingLabel="Suppression…">
            <Trash2 className="h-4 w-4" />
            Supprimer les refusées
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
