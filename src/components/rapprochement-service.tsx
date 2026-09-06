"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { rattacherService } from "@/lib/actions/services";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Select, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { pluriel } from "@/lib/constants";

/**
 * Rattachement d'un libellé orphelin à un service du référentiel.
 *
 * Une ligne par libellé, avec ce qu'il coûte : le nombre de personnes qu'il
 * concerne. Sans ce chiffre, on ne sait pas si on répare une coquille isolée ou
 * la moitié d'une direction, et le ménage se fait dans le désordre.
 */
export function RapprochementService({
  libelle,
  horsAnnuaire,
  annuaire,
  services,
}: {
  libelle: string;
  horsAnnuaire: number;
  annuaire: number;
  services: string[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    rattacherService,
    null,
  );

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{libelle}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {horsAnnuaire > 0 &&
              `${horsAnnuaire} ${pluriel(horsAnnuaire, "personne hors annuaire", "personnes hors annuaire")}`}
            {horsAnnuaire > 0 && annuaire > 0 && " · "}
            {annuaire > 0 &&
              `${annuaire} ${pluriel(annuaire, "compte d'annuaire", "comptes d'annuaire")}`}
          </p>
        </div>

        {horsAnnuaire > 0 ? (
          <form action={action} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="ancien" value={libelle} />
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
            <Select name="vers" defaultValue="" className="w-auto" required>
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
        ) : (
          // Un libellé porté uniquement par des comptes d'annuaire ne se corrige
          // pas ici : la synchronisation le réécrirait. Le dire vaut mieux que
          // d'offrir un bouton qui défait son propre effet pendant la nuit.
          <p className="text-xs text-slate-500">
            À reprendre dans l&apos;Active Directory (<code>department</code>)
          </p>
        )}
      </div>
      <div className="mt-2">
        <Alert state={state} />
      </div>
    </li>
  );
}
