"use client";

import { useActionState, useState, useTransition } from "react";
import { CalendarX2, Check, Undo2, X } from "lucide-react";
import { annulerAbsence, declarerAbsence } from "@/lib/actions/absences";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Card, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { fmtDateLongue } from "@/lib/dates";

export type SeanceAgent = {
  id: string;
  date: Date;
  heureDebut: string;
  heureFin: string;
  lieu: string | null;
  activite: string;
  couleur: string;
  absent: boolean;
  motif: string | null;
  annulee: boolean;
  motifAnnulation: string | null;
};

/**
 * Prochaines séances de l'agent, et déclaration d'absence.
 *
 * ── Deux chemins, parce qu'il y a deux situations ─────────────────────────
 *
 * « Je ne viens pas jeudi » se dit sur la ligne de la séance : c'est là qu'on
 * la voit, et un détour par un formulaire serait plus long que le geste.
 *
 * « Je pars en congés du 15 au 30 » ne se dit pas comme ça. Il fallait
 * auparavant retrouver la première séance concernée dans la liste, l'ouvrir,
 * puis désigner la DERNIÈRE séance couverte — c'est-à-dire faire soi-même la
 * conversion entre des dates de congés et un calendrier d'activités. En
 * pratique on oublie une date sur deux, et l'animateur attend quelqu'un qui ne
 * viendra pas. D'où le bouton « Prévoir une absence », qui prend les deux dates
 * telles qu'on les a en tête et montre ce qu'elles emportent.
 */

/** Clé de comparaison des jours : les dates sont à minuit UTC. */
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** « 2026-09-09 » + n jours, en restant sur le calendrier. */
function dansNJours(jour: string, n: number): string {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Deux jours ISO se comparent comme des chaînes. */
const plusPetit = (a: string, b: string) => (a < b ? a : b);

/** Séances listées d'emblée. Au-delà, la liste se déplie à la demande. */
const APERCU = 6;

export function MesSeances({ seances }: { seances: SeanceAgent[] }) {
  const [state, action] = useActionState<ActionState, FormData>(declarerAbsence, null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [periode, setPeriode] = useState(false);
  const [tout, setTout] = useState(false);
  const [, start] = useTransition();

  const declarables = seances.filter((s) => !s.annulee && !s.absent);
  const annoncees = seances.filter((s) => s.absent && !s.annulee);
  const visibles = tout ? seances : seances.slice(0, APERCU);

  if (seances.length === 0) {
    return (
      <Card title="Mes prochaines séances">
        <EmptyState
          title="Aucune séance à venir"
          hint="Inscrivez-vous à une activité depuis le catalogue."
        />
      </Card>
    );
  }

  return (
    <Card
      title="Mes prochaines séances"
      action={
        declarables.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setPeriode((v) => !v);
              setOuvert(null);
            }}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-50"
          >
            {periode ? (
              <>
                <X className="h-3.5 w-3.5" /> Fermer
              </>
            ) : (
              <>
                <CalendarX2 className="h-3.5 w-3.5" /> Prévoir une absence
              </>
            )}
          </button>
        )
      }
    >
      <div className="mb-3">
        <Alert state={state} />
      </div>

      {periode && (
        <FormulairePeriode
          action={action}
          declarables={declarables}
          onFini={() => setPeriode(false)}
        />
      )}

      <ul className="divide-y divide-slate-100">
        {visibles.map((s) => (
          /* La date d'abord, en tête et en noir.
             Le nom de l'activité y figurait en premier, coloré : sur un agenda
             où l'on suit une seule activité, il est identique d'une ligne à
             l'autre et n'apprend rien, tandis que la date — la seule chose qui
             distingue les lignes — se lisait en gris minuscule dessous. Sur
             téléphone, cela donnait une colonne de « Yoga » empilés.
             Le nom passe en seconde ligne avec le lieu, et garde sa couleur :
             c'est elle qui identifie l'activité, sans rien décaler. Un liseré à
             gauche l'a fait un temps — il poussait chaque ligne de trois
             millimètres vers la droite, si bien qu'aucune ne s'alignait plus ni
             sur le titre de la carte ni sur les cartes voisines. Une colonne
             qu'on lit de haut en bas ne supporte pas ce décalage. */
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3"
          >
            <div className="min-w-0">
              <p
                className={`text-sm font-medium ${s.annulee ? "text-slate-400 line-through" : "text-slate-900"}`}
              >
                <span className="first-letter:uppercase">{fmtDateLongue(s.date)}</span> ·{" "}
                {s.heureDebut}–{s.heureFin}
              </p>
              <p className={`truncate text-xs text-slate-400 ${s.annulee ? "line-through" : ""}`}>
                <span style={s.annulee ? undefined : { color: s.couleur }}>{s.activite}</span>
                {s.lieu ? ` · ${s.lieu}` : ""}
              </p>
              {s.annulee && (
                <p className="mt-1 text-xs font-medium text-red-600">
                  Séance annulée
                  {s.motifAnnulation ? ` — ${s.motifAnnulation}` : ""}
                </p>
              )}
              {s.absent && !s.annulee && (
                <p className="mt-1 text-xs font-medium text-amber-700">
                  Vous avez signalé votre absence
                  {s.motif ? ` — « ${s.motif} »` : ""}
                </p>
              )}
            </div>

            {/* Pastilles plutôt que boutons encadrés : répétée à chaque ligne,
                une bordure orange criait plus fort que le contenu qu'elle
                accompagne. Le geste reste le même, il se voit simplement à sa
                juste place. */}
            {s.annulee ? null : s.absent ? (
              <button
                type="button"
                onClick={() => start(async () => void (await annulerAbsence([s.id])))}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200"
              >
                <Undo2 className="h-3.5 w-3.5" /> Je viens finalement
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setOuvert(ouvert === s.id ? null : s.id);
                  setPeriode(false);
                }}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-100"
              >
                <CalendarX2 className="h-3.5 w-3.5" />
                {ouvert === s.id ? "Fermer" : "Je serai absent"}
              </button>
            )}

            {/* Une seule séance : le formulaire de la ligne ne demande qu'un mot
                pour l'animateur. Les congés se déclarent en haut, où l'on peut
                donner deux dates au lieu de désigner une séance. */}
            {ouvert === s.id && !s.absent && !s.annulee && (
              <form
                action={action}
                onSubmit={() => setOuvert(null)}
                className="mt-1 w-full space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3"
              >
                <input type="hidden" name="seanceId" value={s.id} />
                <ChampMotif />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-amber-800">
                    Seule cette séance sera signalée.
                  </span>
                  <BoutonConfirmer />
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>

      {seances.length > APERCU && (
        <button
          type="button"
          onClick={() => setTout((v) => !v)}
          className="mt-3 text-xs font-medium text-slate-500 underline-offset-2 hover:underline"
        >
          {tout
            ? `Ne montrer que les ${APERCU} prochaines`
            : `Voir mes ${seances.length} séances à venir`}
        </button>
      )}

      {/* Se déclarer absent trois semaines puis voir ses congés annulés arrive :
          on doit pouvoir tout reprendre d'un geste, pas séance par séance. */}
      {annoncees.length > 1 && (
        <button
          type="button"
          onClick={() =>
            start(async () => void (await annulerAbsence(annoncees.map((s) => s.id))))
          }
          className="mt-3 ml-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <Undo2 className="h-3.5 w-3.5" /> Finalement je viens à mes{" "}
          {annoncees.length} séances signalées
        </button>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Prévenir permet à l&apos;animateur de ne pas vous attendre, et au service
        des sports de distinguer un empêchement ponctuel d&apos;un abandon.
      </p>
    </Card>
  );
}

function ChampMotif() {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-amber-900">
        Un mot pour l&apos;animateur ? (facultatif)
      </span>
      <input
        name="motif"
        maxLength={200}
        placeholder="Réunion, congés, blessure…"
        className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
      />
    </label>
  );
}

function BoutonConfirmer({ disabled }: { disabled?: boolean }) {
  return (
    <SubmitButton
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
      pendingLabel="Envoi…"
    >
      <Check className="h-4 w-4" /> Confirmer
    </SubmitButton>
  );
}

/**
 * « Prévoir une absence » : une séance, ou une période.
 *
 * La période se saisit en deux dates — celles du courriel de congés, de l'arrêt
 * de travail, de l'ordre de mission — et l'écran répond par les séances
 * couvertes. C'est la conversion que l'agent faisait de tête, et se trompait à
 * faire : les séances ne tombent pas aux mêmes jours d'une activité à l'autre,
 * et les vacances scolaires en retirent au passage.
 *
 * Les identifiants sont envoyés explicitement, un par séance retenue : le
 * nombre annoncé à l'écran est exactement celui que le serveur traitera, et non
 * le résultat d'un second calcul de dates qui pourrait en différer.
 */
function FormulairePeriode({
  action,
  declarables,
  onFini,
}: {
  action: (formData: FormData) => void;
  declarables: SeanceAgent[];
  onFini: () => void;
}) {
  const premiere = iso(declarables[0].date);
  const derniere = iso(declarables[declarables.length - 1].date);
  const [mode, setMode] = useState<"seance" | "periode">("seance");
  const [seanceId, setSeanceId] = useState(declarables[0].id);
  const [du, setDu] = useState(premiere);
  // Deux semaines par défaut, et non toute la saison : c'est la durée d'un
  // congé ordinaire, et surtout la valeur par défaut ne doit pas être celle
  // qui fait le plus de dégâts. Ouvrir le formulaire puis confirmer sans
  // regarder annulerait sinon l'année entière d'un clic.
  const [au, setAu] = useState(() => plusPetit(dansNJours(premiere, 13), derniere));

  const couvertes =
    mode === "seance"
      ? declarables.filter((s) => s.id === seanceId)
      : declarables.filter((s) => iso(s.date) >= du && iso(s.date) <= au);

  return (
    <form
      action={action}
      onSubmit={() => onFini()}
      className="mb-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5"
    >
      {couvertes.map((s) => (
        <input key={s.id} type="hidden" name="seanceId" value={s.id} />
      ))}

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-amber-900">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="portee"
            checked={mode === "seance"}
            onChange={() => setMode("seance")}
            className="h-4 w-4 accent-amber-600"
          />
          Une séance
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="portee"
            checked={mode === "periode"}
            onChange={() => setMode("periode")}
            className="h-4 w-4 accent-amber-600"
          />
          Une période — congés, arrêt, mission
        </label>
      </div>

      {mode === "seance" ? (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-amber-900">
            Laquelle ?
          </span>
          <select
            value={seanceId}
            onChange={(e) => setSeanceId(e.target.value)}
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
          >
            {declarables.map((s) => (
              <option key={s.id} value={s.id}>
                {s.activite} — {fmtDateLongue(s.date)} · {s.heureDebut}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-amber-900">Du</span>
            <input
              type="date"
              value={du}
              min={premiere}
              max={derniere}
              onChange={(e) => setDu(e.target.value)}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-amber-900">Au</span>
            <input
              type="date"
              value={au}
              min={du}
              max={derniere}
              onChange={(e) => setAu(e.target.value)}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
            />
          </label>
        </div>
      )}

      <ChampMotif />

      {/* Ce que la période emporte, nommément. Deux dates ne disent rien tant
          qu'on n'a pas vu les séances qu'elles couvrent — c'est là qu'on repère
          qu'on a oublié le lundi de la rentrée, ou qu'on en a pris un de trop. */}
      <div className="rounded-lg bg-white/70 px-3 py-2">
        {couvertes.length === 0 ? (
          <p className="text-xs text-amber-800">
            Aucune séance dans cette période : vous n&apos;avez rien à signaler.
          </p>
        ) : (
          <>
            <p className="text-xs font-medium text-amber-900">
              {couvertes.length === 1
                ? "1 séance sera signalée :"
                : `${couvertes.length} séances seront signalées :`}
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
              {couvertes.slice(0, 8).map((s) => (
                <li key={s.id}>
                  <span className="first-letter:uppercase">{fmtDateLongue(s.date)}</span> ·{" "}
                  {s.activite} {s.heureDebut}
                </li>
              ))}
              {couvertes.length > 8 && (
                <li className="text-amber-700">
                  … et {couvertes.length - 8} autres
                </li>
              )}
            </ul>
          </>
        )}
      </div>

      <div className="flex justify-end">
        <BoutonConfirmer disabled={couvertes.length === 0} />
      </div>
    </form>
  );
}
