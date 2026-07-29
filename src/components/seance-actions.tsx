"use client";

import { useActionState } from "react";
import { MessageSquare, UserPlus, XCircle } from "lucide-react";
import {
  ajouterParticipant,
  annulerSeance,
  commenterSeance,
} from "@/lib/actions/seances";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, Textarea, btnSecondary } from "@/components/ui";
import { ChampAgent } from "@/components/champ-agent";
import { SubmitButton } from "@/components/submit-button";

export function AnnulerSeanceForm({
  seanceId,
  aVenir,
}: {
  seanceId: string;
  // Une séance passée se constate ; seule une séance à venir se « prévient ».
  aVenir: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(annulerSeance, null);
  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <input type="hidden" name="seanceId" value={seanceId} />
      <Field label="Motif de l'annulation" required>
        <Input
          name="motif"
          required
          maxLength={200}
          placeholder="Piscine fermée, animateur souffrant…"
        />
      </Field>
      {aVenir && (
        <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-sm">
          <input
            type="checkbox"
            name="prevenir"
            defaultChecked
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            <span className="block font-medium">Prévenir les inscrits par courriel</span>
            <span className="block text-xs text-slate-500">
              Le motif saisi ci-dessus leur est transmis tel quel.
            </span>
          </span>
        </label>
      )}
      <SubmitButton className={btnSecondary} pendingLabel="Annulation…">
        <XCircle className="h-4 w-4" />
        {aVenir ? "Annuler la séance et prévenir" : "Déclarer la séance annulée"}
      </SubmitButton>
    </form>
  );
}

export function CommentaireForm({
  seanceId,
  valeur,
}: {
  seanceId: string;
  valeur: string | null;
}) {
  const [state, action] = useActionState<ActionState, FormData>(commenterSeance, null);
  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <input type="hidden" name="seanceId" value={seanceId} />
      <Textarea
        name="commentaire"
        defaultValue={valeur ?? ""}
        placeholder="Observation sur la séance…"
      />
      <SubmitButton className={btnSecondary}>
        <MessageSquare className="h-4 w-4" /> Enregistrer
      </SubmitButton>
    </form>
  );
}

export function AjouterParticipantForm({
  seanceId,
  // Un animateur signale, il n'arbitre pas : sa demande part en attente de
  // décision, et sa recherche se limite aux agents déjà connus de Bolt.
  gestionnaire,
}: {
  seanceId: string;
  gestionnaire: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(ajouterParticipant, null);
  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <input type="hidden" name="seanceId" value={seanceId} />
      <ChampAgent
        key={state?.success ?? "initial"}
        label="Agent"
        source={gestionnaire ? "annuaire" : "connus"}
        hint="Un agent venu sans être inscrit : il compte dans la fréquentation, distinct des inscrits."
      />
      {/* Décochée par défaut, comme sur la feuille mobile : constater une venue
          et engager une place sur la saison sont deux décisions distinctes. */}
      <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-sm">
        <input
          type="checkbox"
          name="inscrire"
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>
          <span className="block font-medium">
            {gestionnaire ? "Inscrire aussi au créneau" : "Proposer son inscription au créneau"}
          </span>
          <span className="block text-xs text-slate-500">
            {gestionnaire
              ? "Il apparaîtra sur les feuilles suivantes. Créneau complet : placé en liste d'attente."
              : "Le service des sports recevra la demande et décidera."}
          </span>
        </span>
      </label>
      <SubmitButton className={btnSecondary}>
        <UserPlus className="h-4 w-4" /> Ajouter à la séance
      </SubmitButton>
    </form>
  );
}
