"use client";

import { useActionState, type ReactNode } from "react";
import { deposerDemandeAction } from "@/lib/actions/demandes";
import { Alert, Field, Input, Textarea, btnPrimary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/actions/types";

export function DemandeAccesForm({
  email = "",
  intro,
}: {
  email?: string;
  // Rendu au-dessus du formulaire, et seulement tant qu'il est affiché : une
  // fois la demande transmise, « vous n'avez pas encore d'accès » resterait à
  // l'écran au-dessus de l'accusé de réception, à contredire ce qu'il annonce.
  intro?: ReactNode;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    deposerDemandeAction,
    null,
  );

  // Une fois la demande transmise, le formulaire n'a plus lieu d'être : le
  // laisser affiché invite à redéposer la même demande, que le serveur ignorera
  // silencieusement — l'agent en conclurait que rien n'est parti.
  if (state?.success) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <p className="text-sm font-semibold text-emerald-800">Demande transmise</p>
        <p className="mt-1 text-sm text-emerald-700">{state.success}</p>
        <p className="mt-2 text-sm text-emerald-700">
          Vous pourrez vous inscrire aux activités dès que le service des sports
          aura validé votre accès.
        </p>
      </div>
    );
  }

  return (
    <>
      {intro}
      <form
      action={action}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <Alert state={state} />

      {/* Champ leurre : invisible pour un humain, rempli par les robots de
          formulaire. `aria-hidden` et `tabIndex` le retirent aussi du parcours
          au clavier et des lecteurs d'écran — sans quoi il piégerait les
          personnes qu'il est censé protéger. */}
      <div aria-hidden className="hidden">
        <label>
          Organisme
          <input name="organisme_" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {/* Prénom d'abord, et l'exemple le montre : c'est ce qui est saisi ici
          qui ouvrira les courriels de la personne, et rien ne permet ensuite de
          deviner l'ordre — « Parfait Chloé » et « Chloé Parfait » sont
          indiscernables pour la machine. */}
      <Field label="Votre prénom et votre nom" required>
        <Input name="nom" autoComplete="name" placeholder="Camille Martin" autoFocus required />
      </Field>

      <Field
        label="Votre adresse e-mail"
        hint="C'est à cette adresse que le service des sports vous répondra, et par elle que vous vous connecterez ensuite."
        required
      >
        <Input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="prenom.nom@exemple.fr"
          defaultValue={email}
          required
        />
      </Field>

      <Field
        label="Votre service ou votre organisme"
        hint="Facultatif, mais cela évite un aller-retour."
      >
        <Input name="service" placeholder="Piscine municipale, association…" />
      </Field>

      <Field
        label="Précisions"
        hint="Facultatif. Par exemple : « vacataire jusqu'en juin », « agent détaché »."
      >
        <Textarea name="message" rows={3} maxLength={500} />
      </Field>

      <SubmitButton className={`${btnPrimary} w-full justify-center`} pendingLabel="Envoi…">
        Transmettre ma demande
      </SubmitButton>

      <p className="text-xs text-slate-400">
        Aucun compte n&apos;est créé à cette étape. Le service des sports examine
        votre demande, et vous recevrez un message dès qu&apos;il l&apos;aura
        validée. Vous pourrez alors consulter les activités et vous y inscrire.
      </p>
      </form>
    </>
  );
}
