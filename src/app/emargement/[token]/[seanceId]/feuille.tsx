"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check, CheckCheck, X } from "lucide-react";
import type { EtatPresence } from "@prisma/client";
import { pointerEmargement } from "@/lib/actions/emargement";
import type { LigneFeuille } from "@/lib/emargement";
import { BadgePonctuel } from "@/components/ui";

/**
 * Feuille de présence tactile.
 *
 * Le pointage est optimiste : l'état bascule immédiatement à l'écran, l'appel
 * serveur suit. Sur un réseau mobile médiocre — gymnase, sous-sol de piscine —
 * attendre l'aller-retour rendrait la saisie pénible et pousserait l'animateur
 * à taper deux fois.
 */

type Choix = { etat: EtatPresence; label: string; icone: typeof Check; actif: string };

// Deux boutons seulement : sur un téléphone, en gymnase, la question posée à
// l'animateur est « la personne est-elle là ? ». Qu'elle ait prévenu ou non ne
// se devine pas au pointage — c'est l'agent qui l'a déclaré, et cela s'affiche
// juste au-dessus.
const CHOIX: Choix[] = [
  { etat: "PRESENT", label: "Présent(e)", icone: Check, actif: "bg-emerald-600 text-white" },
  { etat: "ABSENT", label: "Absent(e)", icone: X, actif: "bg-red-600 text-white" },
];

export function Feuille({
  token,
  seanceId,
  lignes,
  verrouillee,
}: {
  token: string;
  seanceId: string;
  lignes: LigneFeuille[];
  verrouillee: boolean;
}) {
  const [, startTransition] = useTransition();
  const [etats, setEtats] = useOptimistic(
    Object.fromEntries(lignes.map((l) => [l.userId, l.etat])) as Record<
      string,
      EtatPresence | null
    >,
    (courant, maj: { userId: string; etat: EtatPresence }) => ({
      ...courant,
      [maj.userId]: maj.etat,
    }),
  );
  const [erreur, setErreur] = useState<string | null>(null);

  function pointer(userId: string, etat: EtatPresence) {
    if (verrouillee) return;
    // Une erreur précédente ne doit pas rester affichée une fois que le
    // réseau est revenu et que le pointage suivant passe.
    setErreur(null);
    startTransition(async () => {
      setEtats({ userId, etat });
      try {
        await pointerEmargement(token, seanceId, userId, etat);
      } catch {
        setErreur("Enregistrement impossible. Vérifiez votre connexion puis réessayez.");
      }
    });
  }

  function toutPresent() {
    if (verrouillee) return;
    setErreur(null);
    startTransition(async () => {
      for (const l of restants) setEtats({ userId: l.userId, etat: "PRESENT" });
      try {
        // En série : une dizaine d'appels, et cela évite de saturer un réseau
        // mobile faible avec des requêtes concurrentes.
        for (const l of restants) {
          await pointerEmargement(token, seanceId, l.userId, "PRESENT");
        }
      } catch {
        setErreur("Enregistrement partiel. Vérifiez votre connexion puis réessayez.");
      }
    });
  }

  const presents = lignes.filter(
    (l) => etats[l.userId] === "PRESENT",
  ).length;
  // « Tout le monde est là » saute ceux qui ont prévenu : les marquer présents
  // en masse effacerait précisément l'information qu'ils ont pris soin de
  // donner. Le bouton doit donc annoncer ce qu'il va vraiment pointer, sinon il
  // promet « 3 restants », n'en pointe que deux, et ne disparaît jamais.
  const restants = lignes.filter(
    (l) => etats[l.userId] === null && !l.absenceAnnoncee,
  );
  // Ceux qui ont prévenu et n'ont pas été touchés : comptés absents à la
  // transmission, sans geste. Le compteur du bas les met à part, sinon il
  // annonce « 3 restants » quand il n'y a plus rien à faire.
  const prevenus = lignes.filter(
    (l) => etats[l.userId] === null && l.absenceAnnoncee,
  ).length;

  return (
    <div className="pb-32">
      {erreur && (
        <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {erreur}
        </p>
      )}

      {!verrouillee && restants.length > 0 && (
        <button
          type="button"
          onClick={toutPresent}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 transition active:scale-[0.99]"
        >
          <CheckCheck className="h-4 w-4" />
          Tout le monde est là ({restants.length} restant
          {restants.length > 1 ? "s" : ""})
        </button>
      )}

      <ul className="space-y-2.5">
        {lignes.map((l) => {
          const etat = etats[l.userId];
          return (
            <li
              key={l.userId}
              className={`rounded-2xl border bg-white p-3.5 shadow-sm transition ${
                etat ? "border-slate-200" : "border-slate-300 border-dashed"
              }`}
            >
              <div className="mb-2.5 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold leading-tight">{l.nom}</p>
                  {(l.service || l.direction) && (
                    <p className="truncate text-xs text-slate-500">
                      {l.service ?? l.direction}
                    </p>
                  )}
                </div>
                {l.ponctuel && <BadgePonctuel />}
              </div>

              {l.absenceAnnoncee && (
                <p className="mb-2.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                  A prévenu de son absence
                  {l.motifAbsence ? ` — « ${l.motifAbsence} »` : ""}
                  {etat === null && (
                    <span className="block text-amber-700">
                      Comptée absente à la transmission, sans rien toucher.
                    </span>
                  )}
                </p>
              )}

              <div className="grid grid-cols-2 gap-1.5">
                {CHOIX.map((c) => {
                  const Icone = c.icone;
                  const actif = etat === c.etat;
                  // Personne qui a prévenu et que l'animateur n'a pas encore
                  // touchée : « Absent(e) » s'affiche déjà retenu, en creux. Ce
                  // n'est pas un pointage — rien n'est écrit tant que la feuille
                  // n'est pas transmise —, mais l'animateur n'a rien à faire
                  // pour que cette absence compte, et il le voit.
                  const prevu = etat === null && l.absenceAnnoncee && c.etat === "ABSENT";
                  return (
                    <button
                      key={c.etat}
                      type="button"
                      disabled={verrouillee}
                      onClick={() => pointer(l.userId, c.etat)}
                      aria-pressed={actif}
                      aria-label={`${l.nom} — ${c.label}`}
                      className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium transition active:scale-95 disabled:opacity-60 ${
                        actif
                          ? c.actif
                          : prevu
                            ? "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200"
                            : "bg-slate-50 text-slate-500"
                      }`}
                    >
                      <Icone className="h-4 w-4" />
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Compteur permanent : l'animateur voit d'un coup d'œil ce qui reste.
          Feuille transmise : plus rien à terminer, la barre le dit au lieu de
          proposer un bouton qui mène à une section qui n'existe plus. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-semibold tabular-nums">
              {presents} présent{presents > 1 ? "s" : ""} / {lignes.length}
            </p>
            <p className="text-xs text-slate-500">
              {verrouillee
                ? "Feuille transmise"
                : restants.length === 0
                  ? prevenus > 0
                    ? `Tout le monde est pointé — ${prevenus} ${prevenus > 1 ? "ont" : "a"} prévenu`
                    : "Tout le monde est pointé"
                  : `${restants.length} restant${restants.length > 1 ? "s" : ""}${
                      prevenus > 0 ? ` — ${prevenus} ${prevenus > 1 ? "ont" : "a"} prévenu` : ""
                    }`}
            </p>
          </div>
          {!verrouillee && (
            <a
              href="#transmettre"
              className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-95"
            >
              Terminer
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
