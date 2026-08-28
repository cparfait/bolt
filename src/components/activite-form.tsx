"use client";

import { useActionState, useState } from "react";
import { enregistrerActivite } from "@/lib/actions/activites";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, Textarea, btnPrimary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { COULEURS_ACTIVITE } from "@/lib/constants";

export type ActiviteInitiale = {
  id: string;
  nom: string;
  description: string | null;
  couleur: string;
  capacitePartagee: boolean;
  capacite: number | null;
  suiviPresence: boolean;
};

export function ActiviteForm({
  initiale,
  redirigerVersFiche,
}: {
  initiale?: ActiviteInitiale;
  // Après création depuis la page dédiée, on enchaîne sur la fiche : une
  // activité sans créneau ne sert à rien.
  redirigerVersFiche?: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    enregistrerActivite,
    null,
  );
  const [partagee, setPartagee] = useState(initiale?.capacitePartagee ?? false);
  return (
    <form action={action} className="space-y-4">
      <Alert state={state} />
      {initiale && <input type="hidden" name="id" value={initiale.id} />}
      {redirigerVersFiche && <input type="hidden" name="redirigerVersFiche" value="1" />}
      <Field label="Nom de l'activité" required>
        <Input name="nom" defaultValue={initiale?.nom} required placeholder="Yoga" />
      </Field>
      <Field label="Description" hint="Affichée aux agents dans le catalogue.">
        <Textarea
          name="description"
          defaultValue={initiale?.description ?? ""}
          placeholder="Séance douce, tapis fournis, tous niveaux."
        />
      </Field>
      <Field label="Couleur" hint="Utilisée pour les badges et les graphiques.">
        <div className="flex flex-wrap items-center gap-2">
          {COULEURS_ACTIVITE.map((c) => (
            <label key={c} className="cursor-pointer">
              <input
                type="radio"
                name="couleur"
                value={c}
                defaultChecked={(initiale?.couleur ?? COULEURS_ACTIVITE[0]) === c}
                className="peer sr-only"
              />
              <span
                className="block h-8 w-8 rounded-lg ring-offset-2 transition peer-checked:ring-2 peer-checked:ring-slate-900"
                style={{ backgroundColor: c }}
              />
            </label>
          ))}
        </div>
      </Field>
      {/* Deux façons de compter les places, selon la réalité de l'activité :
          des groupes distincts par créneau, ou un groupe unique qui se répartit
          sur la semaine. Le second cas ne se décrit pas avec des capacités par
          créneau — 10 places le lundi et 10 le jeudi feraient 20 inscrits. */}
      <fieldset className="rounded-xl border border-slate-200 p-4">
        <legend className="px-1.5 text-sm font-medium text-slate-700">
          Places et créneaux
        </legend>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="capacitePartagee"
            checked={partagee}
            onChange={(e) => setPartagee(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            <span className="block font-medium">
              Un seul groupe pour tous les créneaux
            </span>
            <span className="block text-xs text-slate-500">
              Les créneaux sont proposés au même groupe : l&apos;agent
              choisit d&apos;en suivre une, plusieurs ou toutes, sans occuper
              plusieurs places. La liste d&apos;attente est commune.
            </span>
          </span>
        </label>

        {partagee ? (
          <div className="mt-4 sm:max-w-xs">
            <Field
              label="Effectif du groupe"
              required
              hint="Nombre d'agents inscrits à l'activité, toutes séances confondues."
            >
              <Input
                name="capacite"
                type="number"
                min={1}
                max={200}
                defaultValue={initiale?.capacite ?? 10}
                required
              />
            </Field>
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">
            Chaque créneau garde ses propres places, définies sur sa fiche.
          </p>
        )}
      </fieldset>

      {/* Une activité en autonomie n'a personne pour pointer : sans ce
          réglage, ses séances passées comptaient comme des feuilles jamais
          transmises et elle sortait du bilan avec 0 % de présence. */}
      <fieldset className="rounded-xl border border-slate-200 p-4">
        <legend className="px-1.5 text-sm font-medium text-slate-700">
          Suivi de présence
        </legend>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="suiviPresence"
            defaultChecked={initiale?.suiviPresence ?? true}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            <span className="block font-medium">
              Les séances sont émargées par un animateur
            </span>
            <span className="block text-xs text-slate-500">
              Décochez pour une pratique en autonomie — salle en libre accès,
              sans animateur. Aucune feuille ne sera attendue, et l&apos;activité
              n&apos;entrera pas dans le taux de présence du bilan. Les
              inscriptions et le remplissage restent comptés.
            </span>
          </span>
        </label>
      </fieldset>

      <SubmitButton className={btnPrimary}>
        {initiale ? "Enregistrer" : "Créer l'activité"}
      </SubmitButton>
    </form>
  );
}
