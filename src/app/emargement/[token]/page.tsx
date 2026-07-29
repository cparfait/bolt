import Link from "next/link";
import {
  CheckCircle2,
  ChevronRight,
  Dumbbell,
  Lock,
  LogOut,
  XCircle,
} from "lucide-react";
import { resoudreLien } from "@/lib/coach-access";
import { quitterAction } from "@/lib/actions/emargement";
import { JOURS_SAISIE_COACH, saisieOuverte, seancesDuCoach } from "@/lib/emargement";
import { aujourdhui, fmtDateLongue, isoDate } from "@/lib/dates";
import { ChangerPinCoach } from "@/components/changer-pin-coach";
import { InstallerApp } from "@/components/installer-app";
import { PinForm } from "./pin-form";

/**
 * Point d'entrée de l'animateur, joignable depuis Internet.
 *
 * Reprend l'ergonomie de la page de signature de SimCity : une carte centrée,
 * de gros éléments tactiles, aucune navigation superflue — l'animateur est
 * debout, sur son téléphone, entre deux séances.
 */

export const dynamic = "force-dynamic";

function Coquille({ children }: { children: React.ReactNode }) {
  return (
    <main className="emargement min-h-screen bg-slate-50 p-4 pb-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-5 mt-4 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <Dumbbell className="h-4.5 w-4.5" />
          </span>
          <span className="text-xl font-semibold tracking-tight">Bolt</span>
        </div>
        {children}
      </div>
    </main>
  );
}

function Carte({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
  );
}

export default async function EmargementAccueil({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ transmise?: string; annulee?: string }>;
}) {
  const { token } = await params;
  const { transmise, annulee } = await searchParams;
  const lien = await resoudreLien(token);

  if (lien.etat === "INCONNU") {
    return (
      <Coquille>
        <Carte>
          <div className="text-center">
            <XCircle className="mx-auto h-10 w-10 text-slate-300" />
            <h1 className="mt-3 text-lg font-semibold">Lien invalide</h1>
            <p className="mt-2 text-sm text-slate-500">
              Ce lien n&apos;est plus valide. Demandez-en un nouveau au service des sports.
            </p>
          </div>
        </Carte>
      </Coquille>
    );
  }

  if (lien.etat === "EXPIRE" || lien.etat === "DESACTIVE") {
    return (
      <Coquille>
        <Carte>
          <div className="text-center">
            <Lock className="mx-auto h-10 w-10 text-amber-400" />
            <h1 className="mt-3 text-lg font-semibold">
              {lien.etat === "EXPIRE" ? "Lien expiré" : "Accès suspendu"}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Contactez le service des sports pour obtenir un nouvel accès.
            </p>
          </div>
        </Carte>
      </Coquille>
    );
  }

  if (lien.etat === "PIN_REQUIS") {
    return (
      <Coquille>
        <Carte>
          {lien.verrouJusqua ? (
            <div className="text-center">
              <Lock className="mx-auto h-10 w-10 text-red-400" />
              <h1 className="mt-3 text-lg font-semibold">Accès bloqué</h1>
              <p className="mt-2 text-sm text-slate-500">
                Trop de codes erronés. Réessayez dans quelques minutes.
              </p>
            </div>
          ) : (
            <PinForm token={token} prenom={lien.coach.prenom} />
          )}
        </Carte>
      </Coquille>
    );
  }

  // ── Session ouverte : liste des séances ──────────────────────────────────
  const coach = lien.coach;
  const seances = await seancesDuCoach(coach.id);
  const today = isoDate(aujourdhui());
  const duJour = seances.filter((s) => isoDate(s.date) === today);
  // « À compléter » couvre deux cas : la feuille jamais ouverte, et celle
  // commencée mais non transmise. Ne retenir que PLANIFIEE laissait la seconde
  // invisible — or c'est le rattrapage le plus fréquent.
  const aRattraper = seances.filter(
    (s) =>
      isoDate(s.date) < today &&
      !s.clotureeAt &&
      s.statut !== "ANNULEE" &&
      saisieOuverte(s.date),
  );
  const aVenir = seances.filter((s) => isoDate(s.date) > today).slice(0, 5);

  return (
    <Coquille>
      {transmise && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">Feuille transmise</p>
            <p className="text-sm text-emerald-700">
              Merci ! Le service des sports y a accès immédiatement.
            </p>
          </div>
        </div>
      )}
      {annulee && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-800">
          Séance déclarée non tenue. Le service des sports en est informé.
        </div>
      )}

      <div className="mb-3 flex items-center justify-between px-1">
        <p className="text-sm text-slate-500">
          {coach.prenom} {coach.nom}
        </p>
        {/* Téléphone partagé ou prêté : refermer la session PIN en un geste. */}
        <form action={quitterAction}>
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500"
          >
            <LogOut className="h-3.5 w-3.5" /> Quitter
          </button>
        </form>
      </div>

      <InstallerApp />

      <SectionSeances titre="Aujourd'hui" seances={duJour} token={token} vide="Aucune séance aujourd'hui." />

      {aRattraper.length > 0 && (
        <>
          <SectionSeances
            titre="À compléter"
            seances={aRattraper}
            token={token}
            accent
          />
          <p className="-mt-3 mb-5 px-1 text-xs text-amber-600">
            Vous pouvez encore corriger ces feuilles pendant {JOURS_SAISIE_COACH} jours.
            Au-delà, demandez au service des sports.
          </p>
        </>
      )}

      {aVenir.length > 0 && (
        <SectionSeances titre="Prochaines séances" seances={aVenir} token={token} futur />
      )}

      <ChangerPinCoach token={token} />

      <p className="mt-8 text-center text-xs text-slate-400">
        Ce lien est personnel. Ne le transmettez pas.
      </p>
    </Coquille>
  );
}

type SeanceItem = Awaited<ReturnType<typeof seancesDuCoach>>[number];

function SectionSeances({
  titre,
  seances,
  token,
  vide,
  accent,
  futur,
}: {
  titre: string;
  seances: SeanceItem[];
  token: string;
  vide?: string;
  accent?: boolean;
  futur?: boolean;
}) {
  return (
    <section className="mb-5">
      <h2
        className={`mb-2 px-1 text-xs font-semibold uppercase tracking-wide ${accent ? "text-amber-600" : "text-slate-400"}`}
      >
        {titre}
      </h2>
      {seances.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-8 text-center text-sm text-slate-400">
          {vide}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {seances.map((s) => {
            const contenu = (
              <>
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold"
                  style={{
                    backgroundColor: `${s.creneau.activite.couleur}14`,
                    color: s.creneau.activite.couleur,
                  }}
                >
                  {s.creneau.heureDebut.slice(0, 2)}h
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{s.creneau.activite.nom}</p>
                  <p className="truncate text-xs text-slate-400">
                    {fmtDateLongue(s.date)} · {s.creneau.heureDebut}–{s.creneau.heureFin}
                    {s.creneau.lieu ? ` · ${s.creneau.lieu}` : ""}
                  </p>
                </div>
                {s.statut === "ANNULEE" ? (
                  <span className="shrink-0 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600">
                    Annulée
                  </span>
                ) : s.clotureeAt ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                ) : futur ? (
                  <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
                ) : (
                  <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
                )}
              </>
            );

            const classes =
              "flex w-full items-center gap-3 rounded-2xl border bg-white p-3.5 text-left shadow-sm transition";

            return (
              <li key={s.id}>
                {s.statut === "ANNULEE" && !futur ? (
                  <div className={`${classes} border-slate-200 opacity-75`}>{contenu}</div>
                ) : futur ? (
                  /* Une séance à venir s'ouvre sur sa fiche : qui est attendu,
                     et de quoi prévenir qu'elle n'aura pas lieu — le cas échéant
                     les suivantes. Annulée, sa fiche permet d'y revenir. */
                  <Link
                    href={`/emargement/${token}/${s.id}`}
                    className={`${classes} border-slate-200 active:scale-[0.99] active:bg-slate-50 ${
                      s.statut === "ANNULEE" ? "opacity-75" : ""
                    }`}
                  >
                    {contenu}
                  </Link>
                ) : (
                  <Link
                    href={`/emargement/${token}/${s.id}`}
                    className={`${classes} ${accent ? "border-amber-200" : "border-slate-200"} active:scale-[0.99] active:bg-slate-50`}
                  >
                    {contenu}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
