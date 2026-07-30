"use client";

import { useActionState, useState, useTransition } from "react";
import { CalendarX2, Undo2, UserCheck, UserMinus, UserPlus } from "lucide-react";
import { inscrireAgentAction } from "@/lib/actions/inscriptions";
import { desactiverAgent, reactiverAgent } from "@/lib/actions/agents";
import {
  annulerAbsencePourAgent,
  declarerAbsencePourAgent,
} from "@/lib/actions/absences";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, Select, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/**
 * Inscription d'un agent depuis sa fiche : l'agent est déjà identifié, on ne
 * choisit donc que le créneau — contrairement à la page des inscriptions, où
 * il faut d'abord le chercher.
 */
export function InscrireDepuisFiche({
  login,
  creneaux,
}: {
  login: string;
  creneaux: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    inscrireAgentAction,
    null,
  );

  if (creneaux.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Cet agent est déjà positionné sur tous les créneaux de la saison.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <input type="hidden" name="login" value={login} />
      <Field label="Créneau" required>
        <Select name="creneauId" required defaultValue="">
          <option value="">— Choisir —</option>
          {creneaux.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton className={btnSecondary} pendingLabel="Inscription…">
        <UserPlus className="h-4 w-4" /> Inscrire
      </SubmitButton>
    </form>
  );
}

/**
 * Déclaration d'absence pour le compte de l'agent : tout le monde ne passera
 * pas par l'application, beaucoup préviendront par téléphone.
 */
export function AbsencePourAgent({
  userId,
  seances,
}: {
  userId: string;
  seances: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    declarerAbsencePourAgent,
    null,
  );

  if (seances.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Aucune séance à venir sur laquelle signaler une absence. Vérifiez ses
        inscriptions.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <input type="hidden" name="userId" value={userId} />
      <Field label="Séance" required>
        <Select name="seanceId" required defaultValue="">
          <option value="">— Choisir —</option>
          {seances.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Motif" hint="Facultatif — visible par l'animateur.">
        <Input name="motif" maxLength={200} placeholder="Congés, réunion, blessure…" />
      </Field>
      <SubmitButton className={btnSecondary} pendingLabel="Enregistrement…">
        <CalendarX2 className="h-4 w-4" /> Signaler l&apos;absence
      </SubmitButton>
    </form>
  );
}

/** Retrait d'une absence annoncée. */
export function RetirerAbsence({
  seanceId,
  userId,
}: {
  seanceId: string;
  userId: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await annulerAbsencePourAgent(seanceId, userId)))}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
    >
      <Undo2 className="h-3.5 w-3.5" /> Retirer
    </button>
  );
}

/**
 * Départ d'un agent : fermeture de l'accès, et retrait de ses activités.
 *
 * La case est cochée d'avance et le nombre d'inscriptions concernées est
 * annoncé : dans la grande majorité des cas, désactiver un compte signifie que
 * la personne a quitté la collectivité, et laisser sa place réservée pénalise
 * quelqu'un qui attend. Mais elle reste décochable, pour une absence longue au
 * terme de laquelle l'agent retrouvera son créneau.
 *
 * Deux temps volontaires : le panneau ne s'ouvre qu'après un premier clic. Une
 * désactivation ne se déclenche pas d'un bouton isolé au milieu d'une fiche.
 */
export function DesactiverAgent({
  userId,
  nom,
  inscriptions,
}: {
  userId: string;
  nom: string;
  inscriptions: number;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    desactiverAgent,
    null,
  );
  const [ouvert, setOuvert] = useState(false);

  if (state?.success) return <Alert state={state} />;

  if (!ouvert) {
    return (
      <>
        <Alert state={state} />
        <button
          type="button"
          onClick={() => setOuvert(true)}
          className={btnSecondary}
        >
          <UserMinus className="h-4 w-4" /> Désactiver ce compte
        </button>
      </>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <input type="hidden" name="userId" value={userId} />

      <p className="text-sm text-slate-600">
        {nom} ne pourra plus se connecter, ni par son identifiant Windows ni par
        lien e-mail. Les présences déjà émargées sont conservées.
      </p>

      <Field label="Motif" hint="Apparaît au journal et sur les inscriptions retirées.">
        <Input
          name="motif"
          maxLength={200}
          defaultValue="départ de la collectivité"
          required
        />
      </Field>

      <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
        <input
          type="checkbox"
          name="desinscrire"
          defaultChecked
          disabled={inscriptions === 0}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
        />
        <span className="text-sm text-slate-600">
          {inscriptions === 0 ? (
            <>Aucune inscription en cours à retirer.</>
          ) : (
            <>
              Le retirer de ses{" "}
              <span className="font-medium">
                {inscriptions} activité{inscriptions > 1 ? "s" : ""}
              </span>{" "}
              en cours. Les places repartent aussitôt à la liste d&apos;attente.
              Décochez pour une absence temporaire : il gardera sa place.
            </>
          )}
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <SubmitButton className={btnSecondary} pendingLabel="Désactivation…">
          <UserMinus className="h-4 w-4" /> Confirmer la désactivation
        </SubmitButton>
        <button type="button" onClick={() => setOuvert(false)} className={btnSecondary}>
          Annuler
        </button>
      </div>
    </form>
  );
}

/** Réouverture d'un accès fermé. */
export function ReactiverAgent({ userId }: { userId: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Réactiver rouvre l&apos;accès, mais ne remet pas les inscriptions qui
        auraient été retirées : elles se reprennent une par une, ci-dessus.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => void (await reactiverAgent(userId)))}
        className={btnSecondary}
      >
        <UserCheck className="h-4 w-4" /> Réactiver ce compte
      </button>
    </div>
  );
}
