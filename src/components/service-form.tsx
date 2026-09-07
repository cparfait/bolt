"use client";

import { useActionState } from "react";
import { Building2, ClipboardPaste, FileJson, Trash2, Upload, Wand2 } from "lucide-react";
import {
  appliquerRapprochementsSurs,
  importerParametrage,
  collerServices,
  enregistrerService,
  nettoyerServicesRetires,
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

/**
 * Import et export du paramétrage, au format de cybermois.
 *
 * C'est le fichier qui fait que tous les outils de la collectivité parlent
 * des mêmes services : on l'exporte de l'un, on l'importe dans l'autre. Rien
 * n'est figé dans le code — le référentiel et les règles restent modifiables
 * ici, et le fichier n'est qu'un moyen de transport.
 */
export function ImportParametrage() {
  const [state, action] = useActionState<ActionState, FormData>(
    importerParametrage,
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <Field
        label="Fichier de paramétrage"
        hint="Le JSON exporté par cybermois (npm run parametrage -- exporter) ou par Bolt : référentiel et regroupements."
      >
        <Input name="fichier" type="file" accept=".json,application/json" required />
      </Field>
      <label className="flex items-start gap-2 text-sm text-slate-600">
        <input type="checkbox" name="remplacer" defaultChecked className="mt-1" />
        <span>
          Remplacer : retirer de la liste proposée les services absents du
          fichier, et retirer les regroupements qu&apos;il ne mentionne pas.
          Décoché, le fichier complète l&apos;existant.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className={btnPrimary} pendingLabel="Import…">
          <Upload className="h-4 w-4" /> Importer le paramétrage
        </SubmitButton>
        <a
          href="/parametres/services/export"
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-brand-600"
        >
          <FileJson className="h-4 w-4" /> Exporter le paramétrage courant
        </a>
      </div>
      <p className="text-xs text-slate-500">
        Les services déjà présents sont alignés sur l&apos;orthographe du
        fichier, et les comptes suivent. Rien n&apos;est supprimé : un service
        retiré reste sur les fiches qui le portent.
      </p>
    </form>
  );
}

/**
 * Ménage des libellés retirés que plus personne ne porte.
 *
 * Le pendant du rattachement : à mesure que les libellés d'annuaire se
 * rattachent, ceux dont le référentiel avait hérité se vident. Les retirer un
 * par un serait long, et les laisser encombre la seule liste qui doit rester
 * lisible.
 */
export function NettoyerRetires({ total }: { total: number }) {
  const [state, action] = useActionState<ActionState, FormData>(
    nettoyerServicesRetires,
    null,
  );
  return (
    <form action={action} className="space-y-2">
      <Alert state={state} />
      <SubmitButton className={btnSecondary} pendingLabel="Suppression…">
        <Trash2 className="h-4 w-4" />
        Supprimer les {total} libellé{total > 1 ? "s" : ""} que plus personne ne porte
      </SubmitButton>
    </form>
  );
}
