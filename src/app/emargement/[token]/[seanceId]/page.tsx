import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Dumbbell, Lock } from "lucide-react";
import { prisma } from "@/lib/db";
import { resoudreLien } from "@/lib/coach-access";
import { feuilleDeSeance, saisieOuverte } from "@/lib/emargement";
import { aujourdhui, fmtDateLongue, fmtHorodatage, isoDate } from "@/lib/dates";
import { AjouterParticipantMobile } from "@/components/ajouter-participant-mobile";
import { AnnulerSeanceCoach } from "@/components/annuler-seance-coach";
import { RetablirSeanceCoach } from "@/components/retablir-seance-coach";
import { Feuille } from "./feuille";
import { ActionsSeance } from "./actions-seance";

export const dynamic = "force-dynamic";

export default async function FeuillePage({
  params,
}: {
  params: Promise<{ token: string; seanceId: string }>;
}) {
  const { token, seanceId } = await params;
  const lien = await resoudreLien(token);
  // Toute session non ouverte repasse par l'accueil (jeton invalide, PIN à
  // ressaisir, accès révoqué) : la feuille n'est jamais servie sans PIN.
  if (lien.etat !== "OUVERT") {
    return (
      <main className="emargement flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <Lock className="mx-auto h-9 w-9 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">Votre session a expiré.</p>
          <Link
            href={`/emargement/${token}`}
            className="mt-4 inline-flex rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white"
          >
            Ressaisir mon code
          </Link>
        </div>
      </main>
    );
  }

  // La séance doit appartenir à un créneau de cet animateur.
  const appartient = await prisma.seance.findFirst({
    where: { id: seanceId, creneau: { animateurs: { some: { id: lien.coach.id } } } },
    select: { id: true },
  });
  if (!appartient) notFound();

  const feuille = await feuilleDeSeance(seanceId);
  if (!feuille) notFound();

  const { seance, lignes } = feuille;
  const activite = seance.creneau.activite;
  const verrouillee =
    Boolean(seance.clotureeAt) || seance.statut === "ANNULEE" || !saisieOuverte(seance.date);

  // Séance dont le pointage n'est pas encore ouvert : la feuille interactive
  // n'a rien à y faire, l'écran se contente de montrer qui est attendu.
  const avantPointage =
    seance.statut !== "ANNULEE" && seance.date > aujourdhui() && !saisieOuverte(seance.date);

  // Prévenir d'une annulation reste possible tant que la séance n'a pas eu
  // lieu — y compris **celle du jour** : c'est même le cas le plus fréquent,
  // l'animateur qui se sait empêché le matin pour une séance de midi. Le
  // constat après coup, lui, passe par « la séance n'a pas eu lieu ».
  const peutPrevenir =
    seance.statut !== "ANNULEE" && !seance.clotureeAt && seance.date >= aujourdhui();

  // Bornes proposées : les séances suivantes du même créneau. Un empêchement
  // dure rarement une semaine, et les reprendre une par une enverrait autant de
  // courriels aux mêmes agents.
  const suivantes = peutPrevenir
    ? (
        await prisma.seance.findMany({
          where: {
            creneauId: seance.creneauId,
            statut: "PLANIFIEE",
            date: { gt: seance.date },
          },
          orderBy: { date: "asc" },
          take: 12,
          select: { date: true },
        })
      ).map((s, i) => ({
        date: isoDate(s.date),
        libelle: fmtDateLongue(s.date),
        nombre: i + 2, // la séance ouverte, plus toutes celles jusqu'à celle-ci
      }))
    : [];

  return (
    <main className="emargement min-h-screen bg-slate-50 p-4 pb-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-4 mt-2 flex items-center gap-3">
          <Link
            href={`/emargement/${token}`}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"
            aria-label="Retour"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-400">
            <Dumbbell className="h-4 w-4" /> Bolt
          </span>
        </div>

        <div
          className="mb-4 rounded-2xl p-5 text-white shadow-sm"
          style={{ backgroundColor: activite.couleur }}
        >
          <h1 className="text-xl font-semibold">{activite.nom}</h1>
          <p className="mt-0.5 text-sm opacity-90">
            {fmtDateLongue(seance.date)} · {seance.creneau.heureDebut}–
            {seance.creneau.heureFin}
          </p>
          {seance.creneau.lieu && (
            <p className="text-sm opacity-80">{seance.creneau.lieu}</p>
          )}
        </div>

        {seance.statut === "ANNULEE" && (
          <div className="mb-4 space-y-3">
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-700">
              <p className="font-semibold">Séance annulée</p>
              {seance.motifAnnulation && <p className="mt-0.5">{seance.motifAnnulation}</p>}
            </div>
            {/* Une annulation se défait : remplaçant trouvé, salle rendue. */}
            {seance.date >= aujourdhui() && (
              <RetablirSeanceCoach token={token} seanceId={seanceId} />
            )}
          </div>
        )}

        {seance.clotureeAt && seance.statut !== "ANNULEE" && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div className="text-sm text-emerald-800">
              <p className="font-semibold">Feuille transmise</p>
              <p className="text-emerald-700">
                Le {fmtHorodatage(seance.clotureeAt)}. Pour la corriger, contactez le
                service des sports.
              </p>
            </div>
          </div>
        )}

        {!seance.clotureeAt &&
          seance.statut !== "ANNULEE" &&
          !saisieOuverte(seance.date) &&
          !avantPointage && (
            <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm text-slate-500">
              Cette séance est trop ancienne pour être saisie ici. Le service des sports
              peut encore la compléter.
            </div>
          )}

        {lignes.length === 0 ? (
          /* Feuille vide mais séance pointable : l'ajout reste offert — un
             créneau tout neuf accueille souvent ses premiers venus avant que
             la moindre inscription soit validée, et sans ce geste leur venue
             n'existerait nulle part. */
          <>
            {!verrouillee && !avantPointage && (
              <AjouterParticipantMobile token={token} seanceId={seanceId} />
            )}
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-10 text-center">
              <p className="text-sm font-medium text-slate-600">
                Aucun inscrit sur ce créneau
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {!verrouillee && !avantPointage
                  ? "Quelqu'un est venu quand même ? Ajoutez-le ci-dessus : il sera pointé présent."
                  : "Le service des sports doit d'abord valider des inscriptions."}
              </p>
            </div>
          </>
        ) : avantPointage ? (
          /* Liste simplement consultable : pointer une séance qui n'a pas eu
             lieu n'aurait aucun sens, et la feuille interactive afficherait une
             barre « Terminer » sans destination. */
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {lignes.length} inscrit{lignes.length > 1 ? "s" : ""}
            </p>
            <ul className="divide-y divide-slate-100">
              {lignes.map((l) => (
                <li key={l.userId} className="py-2.5">
                  <p className="font-medium leading-tight">{l.nom}</p>
                  {(l.service || l.direction) && (
                    <p className="truncate text-xs text-slate-400">
                      {l.service ?? l.direction}
                    </p>
                  )}
                  {l.absenceAnnoncee && (
                    <p className="mt-1 text-xs text-amber-700">
                      A prévenu de son absence
                      {l.motifAbsence ? ` — « ${l.motifAbsence} »` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
              Le pointage s&apos;ouvrira la veille de la séance.
            </p>
          </div>
        ) : (
          <>
            {/* Quelqu'un se présente sans être inscrit : essai, remplacement,
                collègue de passage. Sans ce geste, sa venue n'existe nulle part
                et la fréquentation réelle est sous-estimée. */}
            {!verrouillee && (
              <AjouterParticipantMobile token={token} seanceId={seanceId} />
            )}
            <Feuille
              token={token}
              seanceId={seanceId}
              lignes={lignes}
              verrouillee={verrouillee}
            />
          </>
        )}

        {!verrouillee && lignes.length > 0 && (
          <ActionsSeance token={token} seanceId={seanceId} />
        )}

        {/* Après la transmission de la feuille : sur une séance du jour, c'est
            elle l'action principale. Sur une séance à venir, c'est la seule. */}
        {peutPrevenir && (
          <div className="mt-4">
            <AnnulerSeanceCoach
              token={token}
              seanceId={seanceId}
              suivantes={suivantes}
            />
          </div>
        )}
      </div>
    </main>
  );
}
