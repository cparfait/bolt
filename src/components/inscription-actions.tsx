"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Clock, X } from "lucide-react";
import { deciderInscription, desisterAction } from "@/lib/actions/inscriptions";
import type { ActionState } from "@/lib/actions/types";

/**
 * Ces boutons n'enregistrent pas seulement une décision : ils font partir un
 * courriel, promeuvent le premier de la liste d'attente et le préviennent à son
 * tour. Une seconde, parfois plusieurs si le serveur SMTP traîne.
 *
 * Sans état d'attente, l'écran ne bougeait pas pendant ce temps — le clic
 * paraissait perdu, on rechargeait la page pour constater qu'il avait bien été
 * pris, ou on recliquait. Chaque bouton se désarme donc et le dit, le temps que
 * l'action revienne.
 */
function BoutonAction({
  children,
  enCours,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { enCours: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      {...props}
      type="submit"
      disabled={pending}
      className={`${props.className ?? ""} disabled:cursor-progress disabled:opacity-60`}
    >
      {pending ? enCours : children}
    </button>
  );
}

/** Trois décisions possibles sur une demande, sur une seule ligne. */
export function DecisionForm({ id }: { id: string }) {
  const [state, action] = useActionState<ActionState, FormData>(deciderInscription, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <BoutonAction
          name="decision"
          value="valider"
          enCours="Inscription…"
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
        >
          <Check className="h-3.5 w-3.5" /> Inscrire
        </BoutonAction>
        <BoutonAction
          name="decision"
          value="attente"
          enCours="Mise en attente…"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <Clock className="h-3.5 w-3.5" /> Attente
        </BoutonAction>
        <BoutonAction
          name="decision"
          value="refuser"
          enCours="Refus…"
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
        >
          <X className="h-3.5 w-3.5" /> Refuser
        </BoutonAction>
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
      <BoutonAction
        title={`Retirer ${nom}`}
        aria-label={`Retirer ${nom}`}
        enCours="Retrait…"
        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600"
      >
        Retirer
      </BoutonAction>
    </form>
  );
}
