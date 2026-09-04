"use client";

import { useActionState, useState } from "react";
import { Check, X } from "lucide-react";
import { refuserDemandeAction, validerDemandeAction } from "@/lib/actions/demandes";
import { Alert, Input, btnDanger, btnPrimary, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/actions/types";

/**
 * Décision sur une demande d'accès.
 *
 * Valider crée un compte et envoie un courriel : le geste est irréversible pour
 * la personne qui le reçoit, d'où la confirmation. Refuser n'envoie rien, mais
 * demande un motif — c'est ce qui permet, des mois plus tard, de répondre à
 * « pourquoi n'ai-je jamais eu d'accès ? » autrement que par une supposition.
 */
export function DemandeAccesActions({
  id,
  nom,
}: {
  id: string;
  nom: string;
}) {
  const [valider, actionValider] = useActionState<ActionState, FormData>(
    validerDemandeAction,
    null,
  );
  const [refus, actionRefus] = useActionState<ActionState, FormData>(
    refuserDemandeAction,
    null,
  );
  const [motifOuvert, setMotifOuvert] = useState(false);

  return (
    <div className="space-y-2">
      <Alert state={valider ?? refus} />

      {motifOuvert ? (
        <form action={actionRefus} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <Input
            name="motif"
            placeholder="Motif du refus (interne)"
            autoFocus
            maxLength={200}
          />
          <p className="text-xs text-slate-400">
            Rien n&apos;est envoyé à la personne : à vous de reprendre contact si
            vous le jugez utile.
          </p>
          <div className="flex flex-wrap gap-2">
            <SubmitButton className={btnDanger} pendingLabel="Refus…">
              Confirmer le refus
            </SubmitButton>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => setMotifOuvert(false)}
            >
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <form
            action={actionValider}
            onSubmit={(e) => {
              if (
                !window.confirm(
                  `Créer un accès pour ${nom} ? Un compte sera créé et la personne recevra un courriel lui annonçant que son accès est ouvert.`,
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="id" value={id} />
            <SubmitButton className={btnPrimary} pendingLabel="Création…">
              <Check className="h-4 w-4" />
              Valider l&apos;accès
            </SubmitButton>
          </form>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => setMotifOuvert(true)}
          >
            <X className="h-4 w-4" />
            Refuser
          </button>
        </div>
      )}
    </div>
  );
}
