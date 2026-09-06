"use client";

import { useActionState } from "react";
import { Building2, ClipboardPaste, DownloadCloud, Wand2 } from "lucide-react";
import {
  appliquerRapprochementsSurs,
  collerServices,
  enregistrerService,
  importerServicesAnnuaire,
} from "@/lib/actions/services";
import type { ActionState } from "@/lib/actions/types";
import {
  Alert,
  Field,
  Input,
  Textarea,
  btnPrimary,
  btnSecondary,
} from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export type ServiceInitial = { id: string; nom: string };

export function ServiceForm({ initial }: { initial?: ServiceInitial }) {
  const [state, action] = useActionState<ActionState, FormData>(
    enregistrerService,
    null,
  );
  return (
    <form action={action} className="space-y-4" key={initial?.id ?? state?.success ?? "n"}>
      <Alert state={state} />
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <Field
        label="Nom du service"
        hint="Tel qu'il doit apparaître sur le bon d'inscription."
        required
      >
        <Input
          name="nom"
          defaultValue={initial?.nom}
          required
          maxLength={120}
          placeholder="Services techniques"
        />
      </Field>
      <SubmitButton className={btnPrimary}>
        <Building2 className="h-4 w-4" />
        {initial ? "Enregistrer le service" : "Ajouter le service"}
      </SubmitButton>
    </form>
  );
}

/**
 * Ajout en masse par collage.
 *
 * Saisir quarante services un par un dans un formulaire est le genre de tâche
 * qu'on ne finit pas. La liste existe déjà dans un organigramme ou un tableur :
 * elle doit pouvoir entrer d'un seul geste, numéros de ligne compris.
 */
export function CollageServices() {
  const [state, action] = useActionState<ActionState, FormData>(collerServices, null);
  return (
    <form action={action} className="space-y-3" key={state?.success ?? "n"}>
      <Alert state={state} />
      <Field
        label="Coller une liste"
        hint="Une ligne par service, ou séparés par des virgules. Les numéros de liste sont ignorés."
      >
        <Textarea
          name="texte"
          rows={5}
          placeholder={"Services techniques\nPetite enfance\nAffaires scolaires"}
        />
      </Field>
      <SubmitButton className={btnSecondary} pendingLabel="Ajout…">
        <ClipboardPaste className="h-4 w-4" />
        Ajouter ces services
      </SubmitButton>
    </form>
  );
}

/**
 * Reprise des services déjà portés par l'annuaire.
 *
 * Sans elle, un référentiel vide se remplit à la main alors que l'AD contient
 * déjà la liste réelle — recopiée, elle le serait avec des écarts, ce qui est
 * exactement le défaut que ce référentiel corrige.
 */
export function ImportServicesAnnuaire() {
  const [state, action] = useActionState<ActionState, FormData>(
    importerServicesAnnuaire,
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <SubmitButton className={btnSecondary} pendingLabel="Import…">
        <DownloadCloud className="h-4 w-4" />
        Reprendre les services de l&apos;annuaire
      </SubmitButton>
      <p className="text-xs text-slate-500">
        Ajoute les libellés portés par les comptes de l&apos;annuaire (attribut{" "}
        <code>department</code>) qui ne figurent pas déjà dans la liste. N&apos;en
        retire aucun, et ne crée pas de doublon : relançable après chaque
        synchronisation.
      </p>
    </form>
  );
}

/**
 * Application en lot des seuls rapprochements sûrs.
 *
 * Les « probables » restent à trancher : trente agents basculés dans le mauvais
 * service ne se remarquent qu'au bilan de fin de saison, et une suggestion
 * fausse présentée comme sûre coûte plus cher que pas de suggestion du tout.
 */
export function AppliquerRapprochements({ surs }: { surs: number }) {
  const [state, action] = useActionState<ActionState, FormData>(
    appliquerRapprochementsSurs,
    null,
  );
  if (surs === 0) return null;
  return (
    <form action={action} className="mb-4 space-y-2">
      <Alert state={state} />
      <SubmitButton className={btnSecondary} pendingLabel="Application…">
        <Wand2 className="h-4 w-4" />
        Appliquer les {surs} rapprochement{surs > 1 ? "s" : ""} sûr
        {surs > 1 ? "s" : ""}
      </SubmitButton>
    </form>
  );
}
