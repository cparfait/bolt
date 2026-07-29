"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { relancerDecrocheurs } from "@/lib/actions/inscriptions";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Textarea, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { Decrocheur } from "@/lib/stats";

/**
 * Relance groupée. Les agents sans adresse e-mail sont listés à part : le
 * service des sports doit les contacter autrement, il ne faut pas qu'ils
 * disparaissent silencieusement de la relance.
 */
export function RelanceForm({ decrocheurs }: { decrocheurs: Decrocheur[] }) {
  const [state, action] = useActionState<ActionState, FormData>(
    relancerDecrocheurs,
    null,
  );
  const avecMail = decrocheurs.filter((d) => d.email);
  const sansMail = decrocheurs.filter((d) => !d.email);

  return (
    <form action={action} className="space-y-4">
      <Alert state={state} />

      {avecMail.length === 0 ? (
        <p className="text-sm text-slate-500">
          Aucun agent relançable par e-mail sur cette liste.
        </p>
      ) : (
        <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 p-3">
          {avecMail.map((d) => (
            <li key={`${d.userId}-${d.creneauId}`}>
              <label className="flex items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="email"
                  value={d.email!}
                  defaultChecked
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span>
                  {d.nom}
                  <span className="ml-2 text-xs text-slate-400">
                    {d.activite} · {d.absencesConsecutives} absences
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {sansMail.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Sans adresse e-mail, à contacter autrement :{" "}
          {sansMail.map((d) => d.nom).join(", ")}.
        </p>
      )}

      <Field label="Message" hint="Laisser vide pour utiliser le message type.">
        <Textarea name="message" rows={4} placeholder="Message type utilisé si vide." />
      </Field>

      <SubmitButton className={btnSecondary} pendingLabel="Envoi…">
        <Send className="h-4 w-4" /> Envoyer la relance
      </SubmitButton>
    </form>
  );
}
