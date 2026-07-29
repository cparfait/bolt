"use client";

import { useActionState } from "react";
import { Check, Clock, X } from "lucide-react";
import { deciderInscription, desisterAction } from "@/lib/actions/inscriptions";
import type { ActionState } from "@/lib/actions/types";

/** Trois décisions possibles sur une demande, sur une seule ligne. */
export function DecisionForm({ id }: { id: string }) {
  const [state, action] = useActionState<ActionState, FormData>(deciderInscription, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="submit"
          name="decision"
          value="valider"
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
        >
          <Check className="h-3.5 w-3.5" /> Inscrire
        </button>
        <button
          type="submit"
          name="decision"
          value="attente"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <Clock className="h-3.5 w-3.5" /> Attente
        </button>
        <button
          type="submit"
          name="decision"
          value="refuser"
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
        >
          <X className="h-3.5 w-3.5" /> Refuser
        </button>
        <input
          name="motif"
          placeholder="Motif (si refus)"
          className="w-40 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
        />
      </div>
    </form>
  );
}

/** Retire un inscrit ; la place repart aussitôt à la liste d'attente. */
export function RetirerForm({ id, nom }: { id: string; nom: string }) {
  const [state, action] = useActionState<ActionState, FormData>(desisterAction, null);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      <button
        type="submit"
        title={`Retirer ${nom}`}
        aria-label={`Retirer ${nom}`}
        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600"
      >
        Retirer
      </button>
    </form>
  );
}
