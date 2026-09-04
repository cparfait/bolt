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
    // L'explication passe en `intro` du formulaire, et non à côté : elle doit
    // disparaître avec lui quand la demande est transmise, sinon « vous n'avez
    // pas encore d'accès » resterait affiché au-dessus de l'accusé de réception.
    return (
      <DemandeAccesForm
        email={state.email ?? ""}
        intro={
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
            <p className="text-sm font-semibold text-slate-700">
              Vous n&apos;avez pas encore d&apos;accès
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Cette adresse n&apos;est pas enregistrée. Dites-nous qui vous êtes :
              le service des sports validera votre demande et vous recevrez un
              message dès que votre accès sera ouvert.
            </p>
          </div>
        }
      />
    );
  }

  return (
    <form
      action={action}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <Alert state={state} />

      {/* L'adresse professionnelle d'abord, parce que c'est le cas de la
          plupart des agents et que c'est elle que porte l'annuaire. Mais elle ne
          couvre pas tout le monde : terrain, crèches, gardiennage ont une boîte
          professionnelle qu'ils n'ouvrent jamais, quand ils en ont une — d'où la
          seconde phrase, qui doit rester visible dès le premier regard et non
          derrière un lien « en savoir plus ». C'est exactement la population
          pour qui cet écran existe. */}
      <Field
        label="Votre adresse e-mail professionnelle"
        hint="Vous n'en avez pas, ou vous ne la consultez jamais ? Indiquez votre adresse personnelle."
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
