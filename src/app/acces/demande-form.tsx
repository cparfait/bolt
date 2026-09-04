"use client";

import { useActionState } from "react";
import { demanderLienAction, type AccesState } from "@/lib/actions/auth";
import { Alert, Field, Input, btnPrimary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DemandeAccesForm } from "@/app/demande-acces/formulaire";

/**
 * Entrée unique de l'espace agent : une adresse, et le serveur aiguille.
 *
 * Trois issues, et l'agent n'a rien à savoir de ces trois cas — c'est tout
 * l'intérêt d'un champ unique. Une adresse du domaine de la collectivité, ou
 * toute adresse déjà enregistrée, reçoit un lien. Une adresse que personne ne
 * connaît fait apparaître ici même le formulaire de demande d'accès, déjà
 * rempli de ce qui vient d'être saisi.
 *
 * Rien n'est envoyé dans ce dernier cas : un courriel de vérification expédié à
 * une adresse que n'importe qui vient de taper ferait de cet écran un moyen de
 * faire écrire la collectivité à des tiers.
 */
export function DemandeLienForm() {
  const [state, action] = useActionState<AccesState, FormData>(
    demanderLienAction,
    null,
  );

  if (state?.inconnue) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
          <p className="text-sm font-semibold text-slate-700">
            Vous n&apos;avez pas encore d&apos;accès
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Cette adresse n&apos;est pas enregistrée. Dites-nous qui vous êtes :
            le service des sports ouvrira votre accès et vous préviendra.
          </p>
        </div>
        <DemandeAccesForm email={state.email ?? ""} />
      </div>
    );
  }

  return (
    <form
      action={action}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <Alert state={state} />

      {/* Ni « professionnelle » ni « personnelle » : c'est l'adresse que le
          service des sports connaît. Beaucoup des agents visés — terrain,
          crèches, gardiennage — sont enregistrés avec une adresse personnelle,
          faute de boîte professionnelle qu'ils consultent. Promettre l'adresse
          professionnelle les envoyait saisir celle qui n'ouvre rien. */}
      <Field
        label="Votre adresse e-mail"
        hint="Celle à laquelle le service des sports vous écrit."
        required
      >
        <Input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="prenom.nom@exemple.fr"
          autoFocus
          required
        />
      </Field>

      <SubmitButton
        className={`${btnPrimary} w-full justify-center`}
        pendingLabel="Envoi…"
      >
        Continuer
      </SubmitButton>

      <p className="text-xs text-slate-400">
        Vous recevez un lien valable 30 minutes. Aucun mot de passe ne vous est
        demandé.
      </p>
    </form>
  );
}
