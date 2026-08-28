"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { LogOut, Plus, ShieldCheck, X } from "lucide-react";
import { desisterAction, inscrireAction } from "@/lib/actions/inscriptions";
import type { ActionState } from "@/lib/actions/types";
import { CHAMP_RGPD, champDeclaration, type TextesLegaux } from "@/lib/declarations";
import { TexteEnLigne, TexteMisEnForme } from "@/components/texte-mis-en-forme";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/**
 * Bouton d'inscription d'un agent à un créneau du catalogue.
 *
 * Le bouton n'inscrit plus directement : il ouvre les déclarations que l'agent
 * signait jusqu'ici sur la fiche papier (état de santé, responsabilité,
 * accident hors temps de travail) et les mentions d'information sur le
 * traitement de ses données. L'inscription en ligne ne doit pas être plus
 * légère que le formulaire qu'elle remplace.
 */
export function InscrireForm({
  creneauId,
  complet,
  intitule,
  textes,
}: {
  creneauId: string;
  complet: boolean;
  /** « Yoga · lundi 17h45–18h45 », rappelé en tête des déclarations. */
  intitule?: string;
  /** Textes en vigueur, lus en base par la page (Paramètres → Déclarations). */
  textes: TextesLegaux;
}) {
  const [state, action] = useActionState<ActionState, FormData>(inscrireAction, null);
  const dialogue = useRef<HTMLDialogElement>(null);
  const [cochees, setCochees] = useState<Set<string>>(new Set());
  const [rgpd, setRgpd] = useState(false);

  const toutAccepte = textes.declarations.every((d) => cochees.has(d.cle)) && rgpd;

  // L'inscription enregistrée, la boîte n'a plus lieu d'être : le résultat
  // s'affiche sur la carte du créneau, à l'endroit où l'agent regardait.
  useEffect(() => {
    if (state?.success) dialogue.current?.close();
  }, [state?.success]);

  function ouvrir() {
    // Chaque inscription est une acceptation neuve : rien n'est pré-coché, y
    // compris à la réouverture après une erreur.
    setCochees(new Set());
    setRgpd(false);
    dialogue.current?.showModal();
  }

  function basculer(cle: string, actif: boolean) {
    setCochees((avant) => {
      const apres = new Set(avant);
      if (actif) apres.add(cle);
      else apres.delete(cle);
      return apres;
    });
  }

  return (
    <div className="space-y-2">
      {state?.success && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {state.success}
        </p>
      )}

      <button
        type="button"
        onClick={ouvrir}
        className={
          complet
            ? "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-sm font-medium text-blue-700 transition hover:bg-blue-50"
            : "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-500"
        }
      >
        <Plus className="h-4 w-4" />
        {complet ? "Rejoindre la liste d'attente" : "M'inscrire"}
      </button>

      {/* <dialog> natif : la touche Échap, le fond modal et le piège de focus
          sont fournis par le navigateur, sans dépendance ni état à hydrater. */}
      <dialog
        ref={dialogue}
        aria-labelledby={`titre-declarations-${creneauId}`}
        className="w-[min(40rem,calc(100vw-1.5rem))] rounded-2xl p-0 text-slate-700 shadow-xl backdrop:bg-slate-900/50 open:animate-none"
      >
        <form action={action} className="flex max-h-[85vh] flex-col">
          <input type="hidden" name="creneauId" value={creneauId} />

          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div>
              <h2
                id={`titre-declarations-${creneauId}`}
                className="text-base font-semibold text-slate-900"
              >
                Avant de valider votre inscription
              </h2>
              {intitule && <p className="mt-0.5 text-xs text-slate-400">{intitule}</p>}
            </div>
            {/* type="button" : dans un <form>, un bouton sans type soumet. */}
            <button
              type="button"
              onClick={() => dialogue.current?.close()}
              aria-label="Fermer"
              className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <p className="text-xs text-slate-500">
              Ces déclarations reprennent celles de la fiche d&apos;inscription papier.
              Elles sont toutes obligatoires.
            </p>

            <ul className="mt-3 space-y-2.5">
              {textes.declarations.map((d) => (
                <li key={d.cle}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 transition hover:bg-slate-50 has-[:checked]:border-brand-200 has-[:checked]:bg-brand-50/40">
                    <input
                      type="checkbox"
                      name={champDeclaration(d.cle)}
                      checked={cochees.has(d.cle)}
                      onChange={(e) => basculer(d.cle, e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                    />
                    <span className="text-xs leading-relaxed">
                      <TexteEnLigne texte={d.texte} />
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldCheck className="h-4 w-4 text-brand-600" />
                Traitement de vos données personnelles
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                Vos données sont recueillies par la commune pour instruire votre demande
                et gérer votre inscription, conservées 14 mois, et destinées à la
                Direction des sports et à la Direction des ressources humaines. Vous
                pouvez retirer votre consentement à tout moment.
              </p>

              {/* Le texte intégral est dépliable plutôt que déroulant : personne
                  ne lit huit paragraphes dans une fenêtre de trois lignes, et
                  les masquer derrière un lien les rendrait inopposables. */}
              <details className="group mt-2">
                <summary className="cursor-pointer list-none text-xs font-medium text-brand-700 underline-offset-2 hover:underline">
                  <span className="group-open:hidden">
                    Lire les mentions d&apos;information en entier
                  </span>
                  <span className="hidden group-open:inline">Replier les mentions</span>
                </summary>
                <div className="mt-2 border-t border-slate-200 pt-2 text-xs leading-relaxed text-slate-500">
                  <TexteMisEnForme texte={textes.rgpdPreambule} />
                  <ul className="mt-2 space-y-1.5">
                    {textes.mentions.map((m) => (
                      <li key={m.intitule}>
                        <strong className="font-semibold text-slate-700">
                          {m.intitule}
                        </strong>{" "}
                        : <TexteEnLigne texte={m.texte} />
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2">
                    <TexteMisEnForme texte={textes.rgpdRecours} />
                  </div>
                </div>
              </details>

              <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:bg-slate-50 has-[:checked]:border-brand-200 has-[:checked]:bg-brand-50/40">
                <input
                  type="checkbox"
                  name={CHAMP_RGPD}
                  checked={rgpd}
                  onChange={(e) => setRgpd(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                />
                <span className="text-xs leading-relaxed">
                  <TexteEnLigne texte={textes.rgpdConsentement} />
                </span>
              </label>
            </div>
          </div>

          {/* Le refus s'affiche dans la boîte, pas derrière elle : la boîte
              reste ouverte tant que l'inscription n'est pas passée, et un
              message caché sous le fond modal n'existe pas pour l'agent. */}
          {state?.error && (
            <p
              role="alert"
              className="mx-5 mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              {state.error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <button
              type="button"
              onClick={() => dialogue.current?.close()}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Annuler
            </button>
            <SubmitButton
              disabled={!toutAccepte}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
              pendingLabel="Envoi…"
            >
              <Plus className="h-4 w-4" />
              {complet ? "J'accepte et je rejoins la liste" : "J'accepte et je m'inscris"}
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </div>
  );
}

/** Désinscription par l'agent lui-même. */
export function DesinscrireForm({ id }: { id: string }) {
  const [state, action] = useActionState<ActionState, FormData>(desisterAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Alert state={state?.error ? state : null} />
      <SubmitButton
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        pendingLabel="…"
      >
        <LogOut className="h-3.5 w-3.5" /> Me désinscrire
      </SubmitButton>
    </form>
  );
}
