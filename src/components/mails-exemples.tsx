"use client";

import { useActionState, useState } from "react";
import { Eye, Mail, Send } from "lucide-react";
import { envoyerExemplesMail } from "@/lib/actions/parametres";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, btnPrimary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

type Exemple = {
  cle: string;
  titre: string;
  quand: string;
  destinataire: string;
  objet: string;
  apercu: string;
};

/**
 * Les messages que Bolt envoie : les voir, et se les envoyer.
 *
 * Écrit pour la démonstration. Montrer ce que reçoit un agent demandait
 * jusqu'ici de provoquer l'événement — valider une inscription, annuler une
 * séance —, ce qui n'est pas faisable devant une commission et pas souhaitable
 * sur des données réelles. Certains de ces messages ne partent qu'une fois par
 * an.
 *
 * L'aperçu est une `iframe` et non du HTML injecté : le gabarit des courriels
 * est écrit en tableaux et styles en ligne pour Outlook, et prendrait sinon
 * les styles de l'application — on regarderait autre chose que le message.
 */
export function MailsExemples({ exemples }: { exemples: Exemple[] }) {
  const [state, action] = useActionState<ActionState, FormData>(
    envoyerExemplesMail,
    null,
  );
  const [ouvert, setOuvert] = useState<string | null>(null);
  // Tous cochés au départ : le geste attendu est « envoie-moi tout », et
  // décocher deux lignes coûte moins que d'en cocher quatorze.
  const [choisis, setChoisis] = useState<Set<string>>(
    () => new Set(exemples.map((e) => e.cle)),
  );

  const basculer = (cle: string) =>
    setChoisis((s) => {
      const suivant = new Set(s);
      if (suivant.has(cle)) suivant.delete(cle);
      else suivant.add(cle);
      return suivant;
    });

  return (
    <form action={action} className="space-y-4">
      <Alert state={state} />

      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="Envoyer les messages cochés à"
          hint="Votre propre adresse, pour la démonstration. Aucun agent n'est destinataire, et l'objet est préfixé « [Exemple] »."
          className="min-w-0 flex-1"
        >
          <Input
            name="destinataire"
            type="email"
            required
            placeholder="prenom.nom@collectivite.fr"
          />
        </Field>
        <SubmitButton className={`${btnPrimary} mb-6`} pendingLabel="Envoi…">
          <Send className="h-4 w-4" /> Envoyer ({choisis.size})
        </SubmitButton>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <button
          type="button"
          onClick={() => setChoisis(new Set(exemples.map((e) => e.cle)))}
          className="text-slate-500 underline-offset-2 hover:text-brand-600 hover:underline"
        >
          Tout cocher
        </button>
        <button
          type="button"
          onClick={() => setChoisis(new Set())}
          className="text-slate-500 underline-offset-2 hover:text-brand-600 hover:underline"
        >
          Tout décocher
        </button>
      </div>

      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {exemples.map((e) => (
          <li key={e.cle} className="py-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                name="cles"
                value={e.cle}
                checked={choisis.has(e.cle)}
                onChange={() => basculer(e.cle)}
                className="mt-1 shrink-0"
                aria-label={`Envoyer « ${e.titre} »`}
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  {e.titre}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">
                    à {e.destinataire}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{e.quand}</p>
                <p className="mt-1 truncate text-xs text-slate-500">
                  <span className="text-slate-500">{e.objet}</span> — {e.apercu}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOuvert(ouvert === e.cle ? null : e.cle)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              >
                <Eye className="h-3.5 w-3.5" />
                {ouvert === e.cle ? "Fermer" : "Voir"}
              </button>
            </div>

            {ouvert === e.cle && (
              <iframe
                src={`/parametres/messagerie/apercu/${e.cle}`}
                title={`Aperçu — ${e.titre}`}
                className="mt-3 h-[32rem] w-full rounded-xl border border-slate-200 bg-white"
              />
            )}
          </li>
        ))}
      </ul>
    </form>
  );
}
