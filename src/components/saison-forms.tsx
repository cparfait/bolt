"use client";

import { useActionState } from "react";
import { CalendarPlus, Save } from "lucide-react";
import {
  ajouterFermeture,
  enregistrerSaison,
} from "@/lib/actions/saisons";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, Select, btnPrimary, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { pluriel } from "@/lib/constants";

/** Saison proposée comme modèle : seules celles qui ont des créneaux à donner. */
export type SaisonModele = { id: string; nom: string; creneaux: number };

export function SaisonForm({
  initiale,
  modeles = [],
}: {
  initiale?: { id: string; nom: string; debut: string; fin: string };
  modeles?: SaisonModele[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(enregistrerSaison, null);
  // À la création seulement : reprendre une grille existante n'a de sens que
  // sur une saison encore vide.
  const reprise = !initiale && modeles.length > 0;
  return (
    <form action={action} className="space-y-4">
      <Alert state={state} />
      {initiale && <input type="hidden" name="id" value={initiale.id} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Nom" required>
          <Input name="nom" defaultValue={initiale?.nom} required placeholder="2026-2027" />
        </Field>
        <Field label="Début" required>
          <Input name="debut" type="date" defaultValue={initiale?.debut} required />
        </Field>
        <Field label="Fin" required>
          <Input name="fin" type="date" defaultValue={initiale?.fin} required />
        </Field>
      </div>
      {reprise && (
        <Field
          label="Reprendre les créneaux d'une saison"
          hint="Activité, jour, horaires, lieu, capacité et animateurs sont recopiés — ni les inscriptions, ni les périodes de vacances, qui sont propres à chaque année. Tout reste modifiable ensuite."
        >
          <Select name="dupliquerDe" defaultValue="">
            <option value="">Aucune — je saisirai les créneaux</option>
            {modeles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nom} — {m.creneaux} {pluriel(m.creneaux, "créneau", "créneaux")}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <SubmitButton className={btnPrimary}>
        <Save className="h-4 w-4" /> {initiale ? "Enregistrer" : "Créer la saison"}
      </SubmitButton>
    </form>
  );
}

export function FermetureForm({ saisonId }: { saisonId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(ajouterFermeture, null);
  return (
    <form action={action} className="space-y-4">
      <Alert state={state} />
      <input type="hidden" name="saisonId" value={saisonId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Libellé" required>
          <Input name="libelle" required placeholder="Vacances de Noël" />
        </Field>
        <Field label="Du" required>
          <Input name="debut" type="date" required />
        </Field>
        <Field label="Au" required>
          <Input name="fin" type="date" required />
        </Field>
      </div>
      <SubmitButton className={btnSecondary}>
        <CalendarPlus className="h-4 w-4" /> Ajouter la période
      </SubmitButton>
    </form>
  );
}
