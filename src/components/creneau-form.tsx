"use client";

import { useActionState, useState } from "react";
import { enregistrerCreneau } from "@/lib/actions/activites";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, Select, btnPrimary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { JOURS, JOUR_LABELS } from "@/lib/dates";

export type CreneauInitial = {
  id: string;
  activiteId: string;
  animateurs: string[]; // identifiants des animateurs rattachés
  jour: string;
  heureDebut: string;
  heureFin: string;
  lieu: string | null;
  capacite: number;
  ouvertInscription: boolean;
  dateDebut: string | null; // « AAAA-MM-JJ », vide = bornes de la saison
  dateFin: string | null;
  fermeturesMaintenues: string[]; // identifiants des périodes traversées
  nbInscrits: number; // pour proposer de prévenir en cas de changement
};

/** Période de fermeture de la saison, telle qu'affichée dans le formulaire. */
export type FermetureOption = { id: string; libelle: string; periode: string };

/** Activité sélectionnable, avec son mode de capacité. */
export type ActiviteOption = {
  id: string;
  nom: string;
  capacitePartagee: boolean;
  capacite: number | null;
};

export function CreneauForm({
  saisonId,
  saisonDebut,
  saisonFin,
  fermetures,
  activites,
  animateurs,
  lieux,
  initial,
  activiteId,
}: {
  saisonId: string;
  saisonDebut: string;
  saisonFin: string;
  fermetures: FermetureOption[];
  activites: ActiviteOption[];
  animateurs: { id: string; nom: string; prenom: string }[];
  lieux: string[]; // libellés actifs du référentiel
  initial?: CreneauInitial;
  activiteId?: string;
}) {
  const maintenuesInitiales = initial?.fermeturesMaintenues ?? [];
  const [state, action] = useActionState<ActionState, FormData>(enregistrerCreneau, null);
  // Le champ « places » disparaît quand l'activité n'a qu'un groupe : la limite
  // vient alors de sa fiche, et deux capacités concurrentes n'auraient aucun
  // sens.
  const [choisie, setChoisie] = useState(initial?.activiteId ?? activiteId ?? "");
  const activiteChoisie = activites.find((a) => a.id === choisie);
  return (
    <form action={action} className="space-y-4">
      <Alert state={state} />
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="saisonId" value={saisonId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Activité" required>
          <Select
            name="activiteId"
            value={choisie}
            onChange={(e) => setChoisie(e.target.value)}
            required
          >
            <option value="">— Choisir —</option>
            {activites.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nom}
              </option>
            ))}
          </Select>
        </Field>
        {/* Plusieurs animateurs possibles : co-animation, binôme titulaire /
            remplaçant. Chacun voit le créneau sur sa propre feuille. */}
        <Field
          label="Animateurs"
          hint="Chacun verra ce créneau sur sa feuille de présence."
        >
          {animateurs.length === 0 ? (
            <p className="text-sm text-slate-400">
              Aucun animateur actif — créez-en un dans « Animateurs ».
            </p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-300 p-2">
              {animateurs.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2.5 rounded px-1.5 py-1 text-sm transition hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    name="animateurs"
                    value={c.id}
                    defaultChecked={(initial?.animateurs ?? []).includes(c.id)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  {c.prenom} {c.nom}
                </label>
              ))}
            </div>
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Jour" required>
          <Select name="jour" defaultValue={initial?.jour ?? "LUNDI"} required>
            {JOURS.map((j) => (
              <option key={j} value={j}>
                {JOUR_LABELS[j]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Début" required>
          <Input
            name="heureDebut"
            defaultValue={initial?.heureDebut ?? "12:15"}
            placeholder="12:15"
            required
          />
        </Field>
        <Field label="Fin" required>
          <Input
            name="heureFin"
            defaultValue={initial?.heureFin ?? "13:15"}
            placeholder="13:15"
            required
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Liste fermée : le lieu se déclare une fois dans les paramètres.
            Le libellé actuel du créneau reste proposé même s'il a été retiré
            de la liste, pour ne pas le perdre en enregistrant autre chose. */}
        <Field
          label="Lieu"
          hint={
            lieux.length === 0
              ? "Aucun lieu déclaré — ajoutez-en dans Paramètres → Lieux."
              : undefined
          }
        >
          <Select name="lieu" defaultValue={initial?.lieu ?? ""}>
            <option value="">— Lieu à préciser —</option>
            {lieux.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
            {initial?.lieu && !lieux.includes(initial.lieu) && (
              <option value={initial.lieu}>{initial.lieu} (retiré de la liste)</option>
            )}
          </Select>
        </Field>
        {activiteChoisie?.capacitePartagee ? (
          <Field label="Places" hint="Définies sur la fiche de l'activité.">
            <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
              Groupe unique de {activiteChoisie.capacite ?? "?"} agents, partagé
              avec les autres créneaux de {activiteChoisie.nom}.
            </p>
          </Field>
        ) : (
          <Field
            label="Places"
            required
            hint="Au-delà, les demandes passent en liste d'attente."
          >
            <Input
              name="capacite"
              type="number"
              min={1}
              max={200}
              defaultValue={initial?.capacite ?? 15}
              required
            />
          </Field>
        )}
      </div>

      {/* Bornes propres au créneau : une activité peut ne durer qu'un
          trimestre, ou démarrer après la rentrée. Vides = toute la saison. */}
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4 sm:grid-cols-2">
        <Field
          label="Première séance"
          hint={`Laisser vide pour démarrer avec la saison (${saisonDebut}).`}
        >
          <Input name="dateDebut" type="date" defaultValue={initial?.dateDebut ?? ""} />
        </Field>
        <Field
          label="Dernière séance"
          hint={`Laisser vide pour aller jusqu'à la fin de saison (${saisonFin}).`}
        >
          <Input name="dateFin" type="date" defaultValue={initial?.dateFin ?? ""} />
        </Field>
      </div>

      {/* Toutes les activités ne s'arrêtent pas aux vacances : la musculation
          en libre accès tourne souvent toute l'année, l'aquagym ferme avec la
          piscine. On liste donc chaque période et on coche celles qui sont
          maintenues. */}
      <fieldset className="rounded-xl border border-slate-200 p-4">
        <legend className="px-1.5 text-sm font-medium text-slate-700">
          Vacances et jours fériés
        </legend>
        {fermetures.length === 0 ? (
          <p className="text-sm text-slate-400">
            Aucune période déclarée sur cette saison. Ajoutez-les dans
            Paramètres → Saisons & calendrier ; les séances correspondantes
            seront alors retirées du calendrier.
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">
              Par défaut, aucune séance n&apos;a lieu pendant ces périodes.
              Cochez celles que ce créneau traverse malgré tout.
            </p>
            <ul className="space-y-1.5">
              {fermetures.map((f) => {
                const maintenue = maintenuesInitiales.includes(f.id);
                return (
                  <li key={f.id}>
                    <label className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm transition hover:bg-slate-50">
                      <span className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          name="fermetureMaintenue"
                          value={f.id}
                          defaultChecked={maintenue}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span>
                          <span className="font-medium">{f.libelle}</span>
                          <span className="ml-2 text-xs text-slate-400">
                            {f.periode}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">
                        {maintenue ? "ouvert" : "fermé"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </fieldset>

      {/* Modifier la règle de vacances en cours de saison change la donne pour
          des agents qui ont organisé leur emploi du temps : on propose de les
          prévenir, et uniquement si le changement les concerne réellement. */}
      {initial && initial.nbInscrits > 0 && (
        <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-sm">
          <input
            type="checkbox"
            name="prevenirInscrits"
            defaultChecked
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            <span className="block font-medium">
              Prévenir les {initial.nbInscrits} inscrits par e-mail
            </span>
            <span className="block text-xs text-slate-500">
              Uniquement si le lieu, l&apos;horaire ou l&apos;ouverture pendant
              les vacances change — ce qui modifie leur déplacement. Aucun
              message pour une correction de capacité ou d&apos;animateur.
            </span>
          </span>
        </label>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          name="ouvertInscription"
          defaultChecked={initial?.ouvertInscription ?? true}
          className="h-4 w-4 rounded border-slate-300"
        />
        Inscriptions ouvertes aux agents
      </label>

      <SubmitButton className={btnPrimary}>
        {initial ? "Enregistrer le créneau" : "Créer le créneau"}
      </SubmitButton>
    </form>
  );
}
