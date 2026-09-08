"use client";

import { useActionState, useState } from "react";
import { MailCheck } from "lucide-react";
import { demanderLienAction, type AccesState } from "@/lib/actions/auth";
import { LIEN_VALIDITE_LIBELLE } from "@/lib/constants";
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
export function DemandeLienForm({ services = [] }: { services?: string[] }) {
  const [state, action] = useActionState<AccesState, FormData>(
    demanderLienAction,
    null,
  );
  const [recommence, setRecommence] = useState(false);

  if (state?.inconnue) {
    // L'explication passe en `intro` du formulaire, et non à côté : elle doit
    // disparaître avec lui quand la demande est transmise, sinon « vous n'avez
    // pas encore d'accès » resterait affiché au-dessus de l'accusé de réception.
    return (
      <DemandeAccesForm
        email={state.email ?? ""}
        services={services}
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

  // Le lien est parti : le formulaire disparaît, remplacé par ce qu'il faut
  // faire maintenant. Il restait auparavant à l'écran, l'adresse encore dans le
  // champ et un bandeau vert au-dessus — on ne savait plus si la demande était
  // partie ou s'il fallait encore appuyer, et beaucoup redemandaient un second
  // lien, ce qui périme le premier.
  if (state?.success && !recommence) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <MailCheck className="h-5 w-5" />
        </span>
        <p className="mt-3 text-base font-semibold text-slate-900">
          Regardez votre messagerie
        </p>
        {/* Fin de phrase assemblée en JavaScript : entre une accolade et le
            mot qui la suit, l'espace se perd à la compilation, et « valable
            1 heureet ne sert » ne se remarque qu'une fois à l'écran. */}
        <p className="mt-1 text-sm text-slate-500">
          Si <strong className="font-medium text-slate-700">{state.email}</strong>
          {` est enregistrée, le lien vient de partir. Il est valable ${LIEN_VALIDITE_LIBELLE} et ne sert qu'une fois.`}
        </p>
        <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-500">
          Rien ne vous parvient ? Regardez vos indésirables. Ne redemandez pas de
          lien tout de suite : un nouveau lien annule le précédent, et si les
          deux arrivent, c&apos;est le dernier qui fonctionne.
        </p>
        <button
          type="button"
          onClick={() => setRecommence(true)}
          className="mt-4 text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
        >
          Ce n&apos;est pas la bonne adresse ? En essayer une autre
        </button>
      </div>
    );
  }

  return (
    <form
      action={action}
      // Retour au formulaire depuis l'écran de confirmation : la prochaine
      // réponse doit le remplacer à son tour.
      onSubmit={() => setRecommence(false)}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <Alert state={state?.success ? null : state} />

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
        Vous recevez un lien valable {LIEN_VALIDITE_LIBELLE}. Aucun mot de passe
        ne vous est demandé.
      </p>
    </form>
  );
}
