"use client";

import { useActionState, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, Link2, Mail } from "lucide-react";
import { genererLienAnimateur, type LienState } from "@/lib/actions/animateurs";
import { Field, Input, btnPrimary, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/**
 * Génération du lien d'émargement.
 *
 * Deux actions distinctes plutôt qu'une case à cocher : générer un accès et
 * l'expédier sont deux décisions différentes, et l'envoi ne doit jamais être le
 * comportement par défaut. Le lien et le code s'affichent dans les deux cas —
 * le code est stocké haché, c'est la seule occasion de le lire.
 */
export function LienForm({
  coachId,
  avecEmail,
  aDejaUnLien,
  finSaison,
}: {
  coachId: string;
  avecEmail: boolean;
  aDejaUnLien: boolean;
  /** Fin de la saison courante, proposée comme échéance par défaut. */
  finSaison?: string;
}) {
  const [state, action] = useActionState<LienState, FormData>(
    genererLienAnimateur,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={coachId} />

      {state?.error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </p>
      )}

      {state?.lien && (
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            À transmettre à l&apos;animateur
          </p>

          <ValeurCopiable etiquette="Lien" valeur={state.lien} />
          <ValeurCopiable etiquette="Code à 6 chiffres" valeur={state.pin} large />

          <p className="text-xs text-emerald-800">
            Notez le code maintenant : il est stocké chiffré et ne pourra plus
            être réaffiché, seulement régénéré.
          </p>

          {state.envoi && (
            <p
              className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                state.envoiEchoue
                  ? "bg-amber-100 text-amber-900"
                  : "bg-white/70 text-emerald-800"
              }`}
            >
              {state.envoiEchoue ? (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <span>
                {state.envoiEchoue
                  ? `L'accès est bien créé, mais l'envoi a échoué : ${state.envoi} Transmettez le lien ci-dessus par un autre moyen.`
                  : state.envoi}
              </span>
            </p>
          )}
        </div>
      )}

      {/* Échéance proposée : la fin de la saison courante.
          Un lien d'émargement est un accès permanent à une page publiée sur
          Internet, dans une URL qui traîne ensuite dans un historique de
          navigateur, un SMS transféré, une capture d'écran. Le laisser vivre
          au-delà de la saison qui l'a justifié n'apporte rien : à la rentrée,
          le service des sports revoit de toute façon ses animateurs. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Expiration"
          hint={
            finSaison
              ? "Fin de la saison en cours. Modifiable ; vider le champ crée un accès sans échéance."
              : "Aucune saison en cours : renseignez une date, ou laissez vide pour un accès sans échéance."
          }
        >
          <Input name="expiration" type="date" defaultValue={finSaison ?? ""} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <SubmitButton className={btnPrimary} pendingLabel="Génération…">
          <Link2 className="h-4 w-4" />
          {aDejaUnLien ? "Régénérer sans envoyer" : "Générer le lien"}
        </SubmitButton>
        {avecEmail && (
          <button
            type="submit"
            name="envoyerMail"
            value="1"
            className={btnSecondary}
          >
            <Mail className="h-4 w-4" /> Générer et envoyer par e-mail
          </button>
        )}
      </div>

      {!avecEmail && (
        <p className="text-xs text-slate-400">
          Cet animateur n&apos;a pas d&apos;adresse e-mail : le lien devra être
          transmis par un autre moyen.
        </p>
      )}
      {aDejaUnLien && (
        <p className="text-xs text-amber-600">
          Régénérer invalide immédiatement le lien actuel.
        </p>
      )}
    </form>
  );
}

/**
 * Valeur affichée en entier, sélectionnable et copiable en un clic.
 *
 * Trois chemins, du plus propre au plus rustique — `navigator.clipboard`
 * n'existe que dans un contexte sécurisé (https, ou localhost), et le
 * back-office est parfois atteint en http par l'adresse IP du serveur. Sans
 * repli, le bouton ne faisait alors rigoureusement rien, sans le dire.
 */
function ValeurCopiable({
  etiquette,
  valeur,
  large,
}: {
  etiquette: string;
  valeur: string;
  large?: boolean;
}) {
  const [etat, setEtat] = useState<"pret" | "copie" | "echec">("pret");
  const affichage = useRef<HTMLElement>(null);

  /** Sélectionne la valeur à l'écran : reste à faire Ctrl+C. */
  const selectionner = () => {
    const noeud = affichage.current;
    const selection = window.getSelection();
    if (!noeud || !selection) return;
    const plage = document.createRange();
    plage.selectNodeContents(noeud);
    selection.removeAllRanges();
    selection.addRange(plage);
  };

  const copier = async () => {
    const reussi = () => {
      setEtat("copie");
      setTimeout(() => setEtat("pret"), 2000);
    };

    // 1. Presse-papiers moderne, contexte sécurisé uniquement.
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(valeur);
        return reussi();
      }
    } catch {
      // refus de permission : on tente le repli
    }

    // 2. Repli historique. Déprécié, mais c'est le seul chemin en http.
    try {
      const zone = document.createElement("textarea");
      zone.value = valeur;
      zone.setAttribute("readonly", "");
      zone.style.position = "fixed";
      zone.style.top = "0";
      zone.style.opacity = "0";
      document.body.appendChild(zone);
      zone.select();
      zone.setSelectionRange(0, valeur.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(zone);
      if (ok) return reussi();
    } catch {
      // navigateur récent ayant retiré execCommand : on passe au 3.
    }

    // 3. Dernier recours : on sélectionne, et on le dit plutôt que d'échouer
    //    en silence.
    selectionner();
    setEtat("echec");
  };

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-emerald-800">{etiquette}</p>
      <div className="flex items-stretch gap-2">
        <code
          ref={affichage}
          onClick={selectionner}
          className={`min-w-0 flex-1 cursor-text select-all break-all rounded-lg bg-white px-3 py-2 font-mono text-emerald-900 ${
            large ? "text-lg tracking-[0.3em]" : "text-sm"
          }`}
        >
          {valeur}
        </code>
        <button
          type="button"
          aria-label={`Copier — ${etiquette}`}
          onClick={copier}
          className="flex w-11 shrink-0 items-center justify-center rounded-lg border border-emerald-300 bg-white text-emerald-700 transition hover:bg-emerald-100"
        >
          {etat === "copie" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      {etat === "copie" && (
        <p className="mt-1 text-xs font-medium text-emerald-700">Copié.</p>
      )}
      {etat === "echec" && (
        <p className="mt-1 text-xs font-medium text-amber-700">
          Copie automatique refusée par le navigateur — le texte est sélectionné,
          faites Ctrl+C.
        </p>
      )}
    </div>
  );
}
