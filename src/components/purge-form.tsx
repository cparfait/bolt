"use client";

import { useActionState, useState } from "react";
import { Trash2, TriangleAlert } from "lucide-react";
import { purgerInscriptionsAction } from "@/lib/actions/parametres";
import type { ActionState } from "@/lib/actions/types";
import { Alert, btnDanger } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/**
 * Purge manuelle des inscriptions et présences échues.
 *
 * Une case de confirmation plutôt qu'un `confirm()` : l'effacement est
 * irréversible et porte sur plusieurs centaines de lignes, ça mérite mieux
 * qu'une boîte de dialogue qu'on referme d'un réflexe. Le décompte affiché
 * part avec la demande — s'il a bougé entre l'affichage et le clic, le serveur
 * refuse : on doit détruire ce qu'on a lu.
 */
export function PurgeForm({
  mois,
  inscriptions,
  presences,
  saisons,
  seuil,
}: {
  mois: number;
  inscriptions: number;
  presences: number;
  saisons: string[];
  seuil: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    purgerInscriptionsAction,
    null,
  );
  const [confirme, setConfirme] = useState(false);

  const rienAFaire = inscriptions === 0 && presences === 0;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="attendu" value={inscriptions} />
      <Alert state={state} />

      <p className="text-xs leading-relaxed text-slate-500">
        Les mentions d&apos;information annoncent une durée de conservation ; c&apos;est
        ici qu&apos;elle s&apos;applique aux inscriptions et aux présences. Sont
        concernées les saisons closes avant le{" "}
        <strong className="font-semibold text-slate-700">{seuil}</strong>, soit{" "}
        {mois} mois. Les séances et les créneaux restent : ils ne portent aucune donnée
        personnelle.
      </p>

      {rienAFaire ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Rien à effacer : aucune saison n&apos;est close depuis plus de {mois} mois.
        </p>
      ) : (
        <>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <p className="flex items-center gap-1.5 font-semibold">
              <TriangleAlert className="h-3.5 w-3.5" />
              {inscriptions} inscription{inscriptions > 1 ? "s" : ""} et {presences}{" "}
              présence{presences > 1 ? "s" : ""} seront effacées définitivement
            </p>
            {saisons.length > 0 && (
              <p className="mt-1">Saisons concernées : {saisons.join(", ")}.</p>
            )}
            <p className="mt-1">
              Les statistiques de fréquentation de ces saisons disparaîtront avec elles.
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={confirme}
              onChange={(e) => setConfirme(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-red-600"
            />
            Je comprends que cet effacement est définitif et sans retour possible.
          </label>

          <SubmitButton
            disabled={!confirme}
            className={`${btnDanger} disabled:cursor-not-allowed disabled:opacity-50`}
            pendingLabel="Effacement…"
          >
            <Trash2 className="h-4 w-4" />
            Purger maintenant
          </SubmitButton>
        </>
      )}
    </form>
  );
}
