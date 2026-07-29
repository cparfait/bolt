"use client";

import { useOptimistic, useTransition } from "react";
import { Check, Undo2, X } from "lucide-react";
import type { EtatPresence } from "@prisma/client";
import { depointerAction, pointerAction } from "@/lib/actions/seances";
import type { LigneFeuille } from "@/lib/emargement";
import { BadgePonctuel, Card, Stat } from "@/components/ui";

/**
 * Feuille de présence du back-office.
 *
 * Responsive par nécessité, pas par confort : un animateur disposant d'un
 * compte Active Directory émarge ici et non sur /emargement — il est donc lui
 * aussi debout avec un téléphone. Cartes empilées et cibles tactiles sous
 * 640 px, ligne compacte au-delà.
 *
 * Les compteurs sont calculés à partir de l'état optimiste, et non rendus côté
 * serveur : sans cela, « 3 présents / 12 » resterait figé jusqu'au prochain
 * rechargement, alors que c'est l'information que l'on regarde en pointant.
 */

// Deux états, pas trois : l'émargement constate une venue, il n'a pas à
// qualifier l'absence. Le fait que l'agent ait prévenu s'affiche déjà en face
// de son nom, et vient de lui.
const CHOIX: { etat: EtatPresence; label: string; icone: typeof Check; actif: string }[] = [
  { etat: "PRESENT", label: "Présent(e)", icone: Check, actif: "bg-emerald-600 text-white" },
  { etat: "ABSENT", label: "Absent(e)", icone: X, actif: "bg-red-600 text-white" },
];

export function FeuilleGestion({
  seanceId,
  lignes,
  verrouillee,
  effectif,
  coachNom,
}: {
  seanceId: string;
  lignes: LigneFeuille[];
  verrouillee: boolean;
  effectif: number;
  coachNom?: string;
}) {
  const [, start] = useTransition();
  const [etats, setEtats] = useOptimistic(
    Object.fromEntries(lignes.map((l) => [l.userId, l.etat])) as Record<
      string,
      EtatPresence | null
    >,
    (courant, maj: { userId: string; etat: EtatPresence | null }) => ({
      ...courant,
      [maj.userId]: maj.etat,
    }),
  );

  function pointer(userId: string, etat: EtatPresence) {
    start(async () => {
      setEtats({ userId, etat });
      await pointerAction(seanceId, userId, etat);
    });
  }

  function effacer(userId: string) {
    start(async () => {
      setEtats({ userId, etat: null });
      await depointerAction(seanceId, userId);
    });
  }

  const presents = lignes.filter(
    (l) => etats[l.userId] === "PRESENT",
  ).length;
  const pointes = lignes.filter((l) => etats[l.userId] !== null).length;

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Inscrits" value={effectif} />
        <Stat label="Présents" value={presents} accent="text-emerald-600 bg-emerald-50" />
        <Stat label="Pointés" value={`${pointes}/${lignes.length}`} />
        {/* Tant que rien n'est pointé, il n'y a pas de taux : afficher « 0 % »
            se lisait « personne n'est venu », alors que la feuille n'a
            simplement pas encore été remplie — le cas de toute séance à venir. */}
        <Stat
          label="Taux de présence"
          value={pointes > 0 ? Math.round((presents / pointes) * 100) : "—"}
          suffixe={pointes > 0 ? "%" : undefined}
          hint={
            pointes === 0
              ? "aucun pointage pour l'instant"
              : pointes < lignes.length
                ? "sur les participants déjà pointés"
                : undefined
          }
        />
      </div>

      <Card
        title="Feuille de présence"
        action={coachNom ? <span className="text-xs text-slate-400">{coachNom}</span> : null}
      >
        <ul className="divide-y divide-slate-100">
          {lignes.map((l) => {
            const etat = etats[l.userId];
            return (
              <li
                key={l.userId}
                className="flex flex-col gap-2.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {l.nom}
                    {l.ponctuel && <BadgePonctuel className="ml-2" />}
                  </p>
                  {(l.service || l.direction) && (
                    <p className="truncate text-xs text-slate-400">
                      {l.service ?? l.direction}
                    </p>
                  )}
                  {l.absenceAnnoncee && (
                    <p className="text-xs text-amber-700">
                      A prévenu de son absence
                      {l.motifAbsence ? ` — « ${l.motifAbsence} »` : ""}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-1.5 sm:flex sm:shrink-0 sm:items-center">
                  {CHOIX.map((c) => {
                    const Icone = c.icone;
                    const actif = etat === c.etat;
                    return (
                      <button
                        key={c.etat}
                        type="button"
                        disabled={verrouillee}
                        aria-pressed={actif}
                        aria-label={`${l.nom} — ${c.label}`}
                        onClick={() => pointer(l.userId, c.etat)}
                        className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium transition active:scale-95 disabled:opacity-50 sm:min-h-0 sm:flex-row sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs ${
                          actif ? c.actif : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                        }`}
                      >
                        <Icone className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                        {c.label}
                      </button>
                    );
                  })}
                  {/* Sur un participant annoncé mais pas encore pointé, ce
                      bouton ne défait pas un pointage : il le retire de la
                      feuille. Sans cela, un ajout erroné sur une séance à venir
                      y restait sans recours. Un inscrit au créneau, lui, n'a
                      rien à effacer tant qu'il n'est pas pointé — et sa place
                      ne se retire pas d'ici. */}
                  <button
                    type="button"
                    disabled={verrouillee || (etat === null && !l.ponctuel)}
                    aria-label={
                      etat === null
                        ? `${l.nom} — retirer de la feuille`
                        : `${l.nom} — effacer le pointage`
                    }
                    onClick={() => effacer(l.userId)}
                    className="col-span-2 flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 sm:col-span-1 sm:min-h-0 sm:px-2.5 sm:py-1.5"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    {etat === null ? "Retirer" : "Effacer"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
