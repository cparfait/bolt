"use client";

import { useActionState, useState } from "react";
import { ShieldAlert, Trash2 } from "lucide-react";
import { reinitialiserDonneesAction } from "@/lib/actions/parametres";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Input, btnDanger } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

const MOT = "REINITIALISER";

/**
 * Remise à zéro de l'exploitation.
 *
 * Un mot à recopier, et non une case à cocher : une case se coche d'un réflexe
 * — c'est même ce qu'on fait pour se débarrasser d'un avertissement. Recopier
 * un mot demande de lire, et personne ne le tape par mégarde. Le décompte est
 * affiché juste au-dessus pour que le geste porte sur quelque chose de connu :
 * « 412 présences » n'a pas le même poids que « les données ».
 */
export function ReinitialisationForm({
  decompte,
}: {
  decompte: {
    presences: number;
    inscriptions: number;
    seances: number;
    creneaux: number;
    activites: number;
    saisons: number;
    animateurs: number;
    lieux: number;
    comptes: number;
    demandes: number;
    journal: number;
  };
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    reinitialiserDonneesAction,
    null,
  );
  const [saisi, setSaisi] = useState("");

  const lignes: [string, number][] = [
    ["Présences saisies", decompte.presences],
    ["Inscriptions", decompte.inscriptions],
    ["Séances", decompte.seances],
    ["Créneaux", decompte.creneaux],
    ["Activités", decompte.activites],
    ["Saisons et périodes de fermeture", decompte.saisons],
    ["Animateurs et leurs accès", decompte.animateurs],
    ["Lieux", decompte.lieux],
    ["Comptes agents et animateurs", decompte.comptes],
    ["Demandes d'accès", decompte.demandes],
    ["Lignes de journal", decompte.journal],
  ];
  const total = lignes.reduce((n, [, v]) => n + v, 0);

  if (state?.success) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-800">Remise à zéro effectuée</p>
        <p className="mt-1 text-sm text-emerald-700">{state.success}</p>
        <p className="mt-2 text-sm text-emerald-700">
          Créez une saison, puis vos activités : l&apos;application est prête à
          recevoir la première inscription.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <Alert state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-3.5">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-red-700">
            <Trash2 className="h-3.5 w-3.5" /> Effacé définitivement
          </p>
          <ul className="space-y-1 text-sm text-red-900">
            {lignes.map(([libelle, valeur]) => (
              <li key={libelle} className="flex items-baseline justify-between gap-3">
                <span>{libelle}</span>
                <span className="shrink-0 font-semibold tabular-nums">{valeur}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Conservé
          </p>
          <ul className="space-y-1 text-sm text-slate-600">
            <li>Annuaire LDAPS et messagerie SMTP</li>
            <li>Paramètres généraux, logos, textes d&apos;accueil</li>
            <li>Référentiel des services et regroupements</li>
            <li>Déclarations et mentions d&apos;information</li>
            <li>Miroir de l&apos;annuaire</li>
            <li>Comptes administrateurs et service des sports</li>
          </ul>
        </div>
      </div>

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
        Cet effacement ne se défait pas et ne fait aucune sauvegarde au passage.
        Si les chiffres de la saison peuvent encore être demandés — bilan QVT,
        comité social —, exportez-les depuis <strong>Statistiques</strong> ou
        faites un instantané de la base avant de continuer.
      </p>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">
          Recopiez <span className="font-mono font-semibold">{MOT}</span> pour
          confirmer
        </span>
        <Input
          name="confirmation"
          value={saisi}
          onChange={(e) => setSaisi(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={MOT}
        />
      </label>

      <SubmitButton
        disabled={saisi.trim().toUpperCase() !== MOT || total === 0}
        className={`${btnDanger} disabled:cursor-not-allowed disabled:opacity-50`}
        pendingLabel="Effacement…"
      >
        <ShieldAlert className="h-4 w-4" />
        {total === 0 ? "Rien à effacer" : "Vider les données d'exploitation"}
      </SubmitButton>
    </form>
  );
}
