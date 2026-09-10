"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, X } from "lucide-react";
import {
  refuserDemandeAction,
  supprimerDemandeAction,
  validerDemandeAction,
} from "@/lib/actions/demandes";
import { Alert, Field, Input, btnDanger, btnPrimary, btnSecondary } from "@/components/ui";
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
  serviceDeclare,
  services,
}: {
  id: string;
  nom: string;
  /** Ce que la personne a tapé, proposé tel quel — à corriger si besoin. */
  serviceDeclare: string | null;
  services: string[];
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
        // Tout sur une ligne : il ne reste qu'un champ, et la décision se prend
        // en lisant la carte au-dessus. Un bloc de formulaire haut de cinq
        // lignes pour un menu déroulant faisait tenir trois demandes à l'écran
        // là où la file en compte parfois vingt.
        <div className="flex flex-wrap items-end gap-2">
          <form
            action={actionValider}
            className="flex flex-wrap items-end gap-2"
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

            {/* Le service se choisit ICI, et pas plus tard sur la fiche : ce
                que la personne a tapé est un texte libre — « Dsi » ne se
                raccorde pas à « DSI », et la fréquentation se répartirait sur
                autant de lignes que d'orthographes. Les suggestions viennent du
                référentiel ; le champ reste libre, un vacataire pouvant relever
                d'un organisme qui n'y figure pas.

                La direction a disparu, comme sur la création d'un participant
                hors annuaire : elle se déduit du service pour les agents de la
                collectivité, et ne veut rien dire pour un élu ou un prestataire.
                Ce que la personne a déclaré s'affiche sur la carte au-dessus, et
                n'a pas à être répété sous le champ qui le reprend déjà. */}
            <Field label="Service" className="w-full sm:w-80">
              <Input
                name="service"
                list={`srv-${id}`}
                defaultValue={serviceDeclare ?? ""}
                autoComplete="off"
              />
              <datalist id={`srv-${id}`}>
                {services.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>

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

/**
 * Suppression d'une demande déjà traitée, réservée à l'administrateur.
 *
 * Une recette ou une démonstration laisse derrière elle des demandes qui ne
 * documentent rien : sans ce bouton, elles restent à demeure dans la liste des
 * traitées, où le service cherche justement les vraies. Discret — un mot en
 * bout de ligne — parce que l'historique des demandes réelles, lui, se garde.
 */
export function SupprimerDemande({ id, nom }: { id: string; nom: string }) {
  const [etat, action] = useActionState<ActionState, FormData>(
    supprimerDemandeAction,
    null,
  );

  return (
    <form
      action={action}
      className="inline-flex items-center gap-2"
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Supprimer définitivement la demande de ${nom} ? La trace de la demande disparaît ; un compte déjà créé, lui, reste en place.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      {/* La suppression groupée exige le même mot : un formulaire qui supprime
          doit le dire, pour qu'une soumission égarée ne l'emporte pas. */}
      <input type="hidden" name="confirmation" value="supprimer" />
      {etat?.error && <span className="text-xs text-red-600">{etat.error}</span>}
      <BoutonSuppression nom={nom} />
    </form>
  );
}

function BoutonSuppression({ nom }: { nom: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title={`Supprimer la demande de ${nom}`}
      className="rounded-lg px-1.5 py-0.5 text-xs text-slate-400 underline-offset-2 transition hover:text-red-600 hover:underline disabled:opacity-50"
    >
      {pending ? "Suppression…" : "Supprimer"}
    </button>
  );
}
