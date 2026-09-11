"use client";

import { useActionState, useState } from "react";
import { FlaskConical, KeyRound, Smartphone } from "lucide-react";
import { chargerJeuDeTestAction, type JeuDeTestState } from "@/lib/actions/parametres";
import { Alert, btnPrimary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/**
 * Chargement du jeu de test.
 *
 * Le compte rendu prend toute la place après coup, et ce n'est pas un luxe :
 * les identifiants créés, leur mot de passe et le code d'émargement ne sont
 * lisibles qu'ici. Le mot de passe est tiré à chaque chargement — donc absent
 * de toute documentation — et le code d'émargement est stocké haché. Recharger
 * la page les perd, et il faut alors les régénérer depuis Animateurs.
 */
export function JeuDeTestForm({ vide }: { vide: boolean }) {
  const [state, action] = useActionState<JeuDeTestState, FormData>(
    chargerJeuDeTestAction,
    null,
  );
  const [confirme, setConfirme] = useState(false);

  if (state?.jeu) {
    const { jeu, lien } = state;
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-800">Jeu de test installé</p>
          {/* Phrase assemblée en JavaScript plutôt qu'en JSX : entre deux
              accolades et un retour à la ligne, les espaces se perdent, et
              « 3demandes » ne se remarque qu'une fois à l'écran. */}
          <p className="mt-1 text-sm text-emerald-700">
            {[
              `Saison ${jeu.saison}`,
              `${jeu.creneaux} créneaux`,
              `${jeu.seances} séances`,
              `${jeu.agents} agents`,
              `${jeu.inscriptions} inscriptions`,
              `${jeu.presences} présences saisies`,
              `${jeu.demandes} demandes d’accès`,
            ].join(" · ")}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <KeyRound className="h-3.5 w-3.5" /> Comptes créés
          </p>
          <ul className="space-y-1 text-sm">
            {jeu.comptes.map((c) => (
              <li key={c.login} className="flex flex-wrap items-baseline gap-2">
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                  {c.login}
                </code>
                <span className="text-slate-500">{c.qui}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            Mot de passe commun :{" "}
            <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-sm font-semibold text-amber-900">
              {jeu.motDePasse}
            </code>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Tiré au hasard pour ce chargement, et affiché une seule fois. Les
            autres agents du jeu n&apos;ont pas de mot de passe : ils figurent
            comme des comptes d&apos;annuaire.
          </p>
        </div>

        {lien && (
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Smartphone className="h-3.5 w-3.5" /> Émargement depuis un téléphone
            </p>
            <p className="break-all font-mono text-xs text-brand-700">{lien.url}</p>
            <p className="mt-2 text-sm">
              Code à 6 chiffres :{" "}
              <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-sm font-semibold text-amber-900">
                {lien.pin}
              </code>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Notez-le : il est stocké haché et ne se réaffiche pas. Un nouveau
              lien se génère à tout moment depuis Animateurs.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <Alert state={state ?? null} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ce qui est créé
          </p>
          <ul className="space-y-1 text-sm text-slate-600">
            <li>Une saison calée sur aujourd&apos;hui, et ses vacances scolaires</li>
            <li>4 activités, 5 créneaux, 4 animateurs</li>
            <li>31 agents fictifs répartis sur quatre directions</li>
            <li>Inscriptions, listes d&apos;attente et demandes à arbitrer</li>
            <li>Un historique de présences, feuilles manquantes comprises</li>
            <li>Des demandes d&apos;accès et quelques lignes de journal</li>
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ce qui n&apos;est pas touché
          </p>
          <ul className="space-y-1 text-sm text-slate-600">
            <li>Annuaire LDAPS et messagerie SMTP</li>
            <li>Paramètres généraux, logos, textes d&apos;accueil</li>
            <li>Référentiel des services et regroupements</li>
            <li>Déclarations et mentions d&apos;information</li>
            <li>Comptes administrateurs et service des sports</li>
          </ul>
        </div>
      </div>

      {vide ? (
        <>
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
            Ces données sont fictives et destinées à essayer l&apos;application.
            Elles s&apos;effacent d&apos;un coup par la remise à zéro ci-dessus —
            le jeu de test crée exactement ce qu&apos;elle supprime. Aucun courriel
            n&apos;est envoyé au passage.
          </p>

          <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              name="confirmation"
              checked={confirme}
              onChange={(e) => setConfirme(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brand-600"
            />
            J&apos;installe des données fictives : cette base n&apos;est pas en
            service, ou je viens de la remettre à zéro.
          </label>

          <SubmitButton
            disabled={!confirme}
            className={`${btnPrimary} disabled:cursor-not-allowed disabled:opacity-50`}
            pendingLabel="Création…"
          >
            <FlaskConical className="h-4 w-4" />
            Charger le jeu de test
          </SubmitButton>
        </>
      ) : (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-500">
          La base contient déjà des données d&apos;exploitation. Le jeu de test ne
          s&apos;installe que sur une base vide : mêlés à de vrais agents, ces
          comptes fictifs ne se distingueraient plus dans les listes ni dans les
          statistiques. Faites d&apos;abord une remise à zéro.
        </p>
      )}
    </form>
  );
}
