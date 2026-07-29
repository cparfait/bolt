import Link from "next/link";
import { AlertTriangle, CalendarX2 } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { estGestionnaire, requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import { aujourdhui, ajouterJours, fmtDateComplete, isoDate } from "@/lib/dates";
import { Badge, EmptyState, PageHeader, Select, btnSecondary } from "@/components/ui";
import { FiltreActivites } from "@/components/filtre-activites";
import { FiltreForm } from "@/components/filtre-form";
import { pluriel } from "@/lib/constants";

const PERIODES = {
  semaine: { label: "Cette semaine", avant: 0, apres: 7 },
  mois: { label: "30 prochains jours", avant: 0, apres: 30 },
  passees: { label: "30 derniers jours", avant: 30, apres: 0 },
  manquantes: { label: "Feuilles non transmises", avant: 60, apres: 0 },
} as const;

type Periode = keyof typeof PERIODES;

export default async function SeancesPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string; activite?: string }>;
}) {
  const user = await requireUser("GESTIONNAIRE", "COACH");
  const { periode: periodeBrute, activite } = await searchParams;
  const periode: Periode =
    periodeBrute && periodeBrute in PERIODES ? (periodeBrute as Periode) : "semaine";
  const p = PERIODES[periode];

  const saison = await saisonCourante();
  if (!saison) {
    return (
      <>
        <PageHeader title="Planning" />
        <EmptyState title="Aucune saison configurée" />
      </>
    );
  }

  // Un animateur connecté avec un compte ne voit que ses propres créneaux.
  let coachId: string | undefined;
  if (!estGestionnaire(user)) {
    const coach = await prisma.coach.findUnique({ where: { userId: user.id } });
    if (!coach) {
      return (
        <>
          <PageHeader title="Planning" />
          <EmptyState
            title="Aucun créneau ne vous est rattaché"
            hint="Le service des sports doit vous associer à un créneau."
          />
        </>
      );
    }
    coachId = coach.id;
  }

  const where: Prisma.SeanceWhereInput = {
    creneau: {
      saisonId: saison.id,
      ...(coachId ? { animateurs: { some: { id: coachId } } } : {}),
      ...(activite ? { activiteId: activite } : {}),
    },
    date: {
      gte: ajouterJours(aujourdhui(), -p.avant),
      lte: ajouterJours(aujourdhui(), p.apres),
    },
    ...(periode === "manquantes" ? { statut: "PLANIFIEE" as const } : {}),
  };

  const [seances, activites] = await Promise.all([
    prisma.seance.findMany({
      where,
      include: {
        creneau: {
          include: {
            activite: true,
            animateurs: true,
            // Effectif attendu sur les séances à venir : c'est ce qu'on veut
            // savoir en lisant un planning, bien plus que « planifiée ».
            _count: { select: { inscriptions: { where: { statut: "VALIDEE" } } } },
          },
        },
        _count: {
          select: {
            presences: { where: { etat: "PRESENT" } },
            absences: true, // absences annoncées à l'avance par les agents
          },
        },
      },
      orderBy: [{ date: "asc" }, { creneau: { heureDebut: "asc" } }],
      take: 200,
    }),
    prisma.activite.findMany({
      where: {
        creneaux: {
          some: {
            saisonId: saison.id,
            ...(coachId ? { animateurs: { some: { id: coachId } } } : {}),
          },
        },
      },
      orderBy: { nom: "asc" },
      select: { id: true, nom: true, couleur: true, actif: true },
    }),
  ]);

  // Regroupement par jour : la lecture d'un planning se fait par date.
  const parJour = new Map<string, typeof seances>();
  for (const s of seances) {
    const cle = isoDate(s.date);
    parJour.set(cle, [...(parJour.get(cle) ?? []), s]);
  }

  const today = isoDate(aujourdhui());

  return (
    <>
      <PageHeader
        title="Planning"
        subtitle={`Saison ${saison.nom} — ${seances.length} ${pluriel(seances.length, "séance")}`}
      >
        {/* La période reste un menu déroulant : ce sont des plages, pas des
            catégories, et une pastille par période brouillerait la lecture. */}
        <FiltreForm>
          {activite && <input type="hidden" name="activite" value={activite} />}
          <Select name="periode" defaultValue={periode} className="w-auto">
            {Object.entries(PERIODES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </FiltreForm>
        <Link href="/seances/annuler" className={btnSecondary}>
          <CalendarX2 className="h-4 w-4" /> Annuler des séances
        </Link>
      </PageHeader>

      <FiltreActivites
        base="/seances"
        selection={activite}
        activites={activites}
        params={{ periode }}
      />

      {periode === "manquantes" && seances.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            {seances.length} séance{seances.length > 1 ? "s" : ""} sans émargement.
            Relancez l&apos;animateur ou complétez la feuille vous-même.
          </p>
        </div>
      )}

      {seances.length === 0 ? (
        <EmptyState
          title="Aucune séance sur cette période"
          hint={
            periode === "manquantes"
              ? "Toutes les feuilles ont été transmises."
              : "Vérifiez les créneaux et le calendrier de la saison."
          }
        />
      ) : (
        /* Une seule liste continue, les jours en intertitres : un planning se
           parcourt du regard. Découpé en cartes, il ne tenait pas à l'écran et
           obligeait à faire défiler pour comparer deux jours. */
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {[...parJour.entries()].map(([jour, liste]) => (
            <section key={jour}>
              <h2 className="flex flex-wrap items-baseline gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 first:border-t-0">
                <span className="first-letter:uppercase">{fmtDateComplete(jour)}</span>
                {jour === today && (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold normal-case text-indigo-700">
                    aujourd&apos;hui
                  </span>
                )}
              </h2>
              <ul className="divide-y divide-slate-100">
                {liste.map((s) => {
                  // Le statut n'est signalé que lorsqu'il demande quelque chose :
                  // une séance simplement planifiée n'apprend rien, alors que
                  // l'effectif attendu ou une feuille manquante, si.
                  const passee = isoDate(s.date) < today;
                  const attendus = s.creneau._count.inscriptions - s._count.absences;
                  return (
                    <li key={s.id}>
                      <Link
                        href={`/seances/${s.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50"
                      >
                        <span
                          className="h-9 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: s.creneau.activite.couleur }}
                          aria-hidden
                        />
                        <span className="w-24 shrink-0 text-sm tabular-nums text-slate-500 sm:w-28">
                          {s.creneau.heureDebut}
                          <span className="text-slate-300">–</span>
                          {s.creneau.heureFin}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {s.creneau.activite.nom}
                          </span>
                          <span className="block truncate text-xs text-slate-400">
                            {[
                              s.creneau.lieu,
                              s.creneau.animateurs.length > 0
                                ? s.creneau.animateurs
                                    .map((c) => `${c.prenom} ${c.nom}`)
                                    .join(", ")
                                : "animateur à désigner",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          {s.statut === "ANNULEE" ? (
                            <Badge color="bg-red-100 text-red-700 ring-red-500/20">
                              Annulée
                            </Badge>
                          ) : s.statut === "FAITE" ? (
                            <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-500/20">
                              {s._count.presences} {pluriel(s._count.presences, "présent")}
                            </Badge>
                          ) : passee ? (
                            <Badge color="bg-amber-100 text-amber-800 ring-amber-500/20">
                              À émarger
                            </Badge>
                          ) : (
                            <>
                              <span className="block text-sm tabular-nums text-slate-600">
                                {attendus} attendus
                              </span>
                              {s._count.absences > 0 && (
                                <span className="block text-xs tabular-nums text-amber-600">
                                  {s._count.absences}{" "}
                                  {pluriel(s._count.absences, "absence annoncée")}
                                </span>
                              )}
                            </>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
