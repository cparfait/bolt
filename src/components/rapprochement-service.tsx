"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { regrouperLibelle } from "@/lib/actions/services";
import type { ActionState } from "@/lib/actions/types";
import type { Confiance, Suggestion } from "@/lib/rapprochement";
import { Alert, Badge, Select, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { pluriel } from "@/lib/constants";

/**
 * Une ligne d'inventaire : un libellé brut, ce qu'il pèse, et le service que le
 * moteur propose d'y rattacher.
 *
 * Le niveau de confiance est affiché, jamais masqué derrière un simple choix
 * pré-rempli : une suggestion fausse présentée comme sûre fait basculer trente
 * agents dans le mauvais service, et personne ne le remarque avant le bilan de
 * fin de saison. Le motif est écrit à côté — « sigle de … », « mots en
 * commun : … » — pour que la décision se prenne sans deviner.
 */

const ALLURE: Record<Confiance, { libelle: string; classe: string }> = {
  sure: {
    libelle: "sûre",
    classe: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  },
  probable: {
    libelle: "probable",
    classe: "bg-amber-50 text-amber-700 ring-amber-600/20",
  },
  incertaine: {
    libelle: "incertaine",
    classe: "bg-slate-100 text-slate-600 ring-slate-500/20",
  },
  aucune: { libelle: "", classe: "" },
};

export function RapprochementService({
  suggestion,
  services,
}: {
  suggestion: Suggestion;
  services: string[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    regrouperLibelle,
    null,
  );
  const { libelle, horsAnnuaire, annuaire, confiance, proposition, motif, ambigu } =
    suggestion;
  const effectif = horsAnnuaire + annuaire;
  const allure = ALLURE[confiance];

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {libelle}
            {confiance !== "aucune" && (
              <Badge color={allure.classe}>{allure.libelle}</Badge>
            )}
            {ambigu && <Badge>ambigu</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {effectif} {pluriel(effectif, "personne", "personnes")}
            {horsAnnuaire > 0 && annuaire > 0
              ? ` · dont ${annuaire} de l'annuaire`
              : annuaire > 0
                ? " · de l'annuaire"
                : " · hors annuaire"}
            {motif ? ` · ${motif}` : ""}
          </p>
        </div>

        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="source" value={libelle} />
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
          {/* La proposition est pré-sélectionnée mais jamais appliquée seule :
              c'est un gain de clics, pas une décision prise à la place du
              service des sports. */}
          <Select
            name="vers"
            defaultValue={proposition ?? ""}
            className="w-auto"
            required
          >
            <option value="">Rattacher à…</option>
            {services.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <SubmitButton className={btnSecondary} pendingLabel="…">
            Rattacher
          </SubmitButton>
        </form>
      </div>
      <div className="mt-2">
        <Alert state={state} />
      </div>
    </li>
  );
}
