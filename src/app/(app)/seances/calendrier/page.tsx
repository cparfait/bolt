import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import {
  ajouterJours,
  aujourdhui,
  debutMois,
  debutSemaine,
  finMois,
  finSemaine,
  fmtDate,
  fmtMois,
  isoDate,
  jourUtc,
} from "@/lib/dates";
import { EmptyState, PageHeader, btnSecondary } from "@/components/ui";
import { FiltreActivites } from "@/components/filtre-activites";
import {
  CalendrierSeances,
  type JourCalendrier,
  type SeanceCalendrier,
} from "@/components/calendrier-seances";

/**
 * Vue calendrier du planning, réservée au service des sports.
 *
 * Elle sert surtout au moment de mettre une activité en place : vérifier d'un
 * coup d'œil les séances générées sur l'année, et retirer celles qui n'auront
 * pas lieu — en les sélectionnant directement dans la grille, comme dans un
 * agenda. Tant que personne n'est inscrit, aucun courriel ne part ; en cours
 * d'année, les inscrits sont prévenus.
 *
 * Les périodes de fermeture de la saison (vacances, jours fériés) apparaissent
 * en fond ambré : les séances n'y sont pas générées du tout.
 */
export default async function CalendrierPage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string; date?: string; activite?: string }>;
}) {
  await requireUser("GESTIONNAIRE");
  const { vue: vueBrute, date: dateBrute, activite } = await searchParams;
  const vue: "mois" | "semaine" = vueBrute === "semaine" ? "semaine" : "mois";

  const saison = await saisonCourante();
  if (!saison) {
    return (
      <>
        <PageHeader title="Calendrier" />
        <EmptyState title="Aucune saison configurée" />
      </>
    );
  }

  const ancre = /^\d{4}-\d{2}-\d{2}$/.test(dateBrute ?? "")
    ? jourUtc(dateBrute!)
    : aujourdhui();

  // La grille du mois est complétée aux semaines pleines, du lundi au dimanche.
  const debutGrille =
    vue === "mois" ? debutSemaine(debutMois(ancre)) : debutSemaine(ancre);
  const finGrille = vue === "mois" ? finSemaine(finMois(ancre)) : finSemaine(ancre);

  const [seances, fermetures, activites] = await Promise.all([
    prisma.seance.findMany({
      where: {
        date: { gte: debutGrille, lte: finGrille },
        creneau: {
          saisonId: saison.id,
          ...(activite ? { activiteId: activite } : {}),
        },
      },
      include: {
        creneau: {
          select: {
            heureDebut: true,
            heureFin: true,
            lieu: true,
            activite: { select: { nom: true, couleur: true } },
            _count: { select: { inscriptions: { where: { statut: "VALIDEE" } } } },
          },
        },
        _count: { select: { presences: { where: { etat: "PRESENT" } } } },
      },
      orderBy: [{ date: "asc" }, { creneau: { heureDebut: "asc" } }],
    }),
    prisma.fermeture.findMany({
      where: { saisonId: saison.id, debut: { lte: finGrille }, fin: { gte: debutGrille } },
      orderBy: { debut: "asc" },
    }),
    prisma.activite.findMany({
      where: { creneaux: { some: { saisonId: saison.id } } },
      orderBy: { nom: "asc" },
      select: { id: true, nom: true, couleur: true, actif: true },
    }),
  ]);

  const todayIso = isoDate(aujourdhui());
  const parJour = new Map<string, SeanceCalendrier[]>();
  for (const s of seances) {
    const iso = isoDate(s.date);
    parJour.set(iso, [
      ...(parJour.get(iso) ?? []),
      {
        id: s.id,
        heureDebut: s.creneau.heureDebut,
        heureFin: s.creneau.heureFin,
        activite: s.creneau.activite.nom,
        couleur: s.creneau.activite.couleur,
        lieu: s.creneau.lieu,
        inscrits: s.creneau._count.inscriptions,
        presents: s._count.presences,
        statut: s.statut,
        annulable: s.statut === "PLANIFIEE" && iso >= todayIso,
      },
    ]);
  }

  const jours: JourCalendrier[] = [];
  for (let d = debutGrille; d <= finGrille; d = ajouterJours(d, 1)) {
    const iso = isoDate(d);
    const fermeture = fermetures.find(
      (f) => isoDate(f.debut) <= iso && iso <= isoDate(f.fin),
    );
    jours.push({
      iso,
      numero: d.getUTCDate(),
      horsMois: vue === "mois" && d.getUTCMonth() !== ancre.getUTCMonth(),
      aujourdHui: iso === todayIso,
      fermeture: fermeture?.libelle ?? null,
      seances: parJour.get(iso) ?? [],
    });
  }

  const lien = (d: Date, v: "mois" | "semaine" = vue) => {
    const q = new URLSearchParams({ vue: v, date: isoDate(d) });
    if (activite) q.set("activite", activite);
    return `/seances/calendrier?${q.toString()}`;
  };
  const precedent =
    vue === "mois" ? ajouterJours(debutMois(ancre), -1) : ajouterJours(ancre, -7);
  const suivant =
    vue === "mois" ? ajouterJours(finMois(ancre), 1) : ajouterJours(ancre, 7);
  const libelle =
    vue === "mois"
      ? fmtMois(ancre)
      : `Du ${fmtDate(debutGrille)} au ${fmtDate(finGrille)}`;

  const btnNav =
    "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50";
  const btnVue = (active: boolean) =>
    `px-3.5 py-1.5 text-sm font-medium transition ${
      active ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
    }`;

  return (
    <>
      <Link
        href="/seances"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Retour au planning
      </Link>

      <PageHeader
        title="Calendrier"
        subtitle={`Saison ${saison.nom} — sélectionnez des séances pour les annuler`}
      >
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 shadow-sm">
          <Link href={lien(ancre, "mois")} className={btnVue(vue === "mois")}>
            Mois
          </Link>
          <Link
            href={lien(ancre, "semaine")}
            className={`border-l border-slate-300 ${btnVue(vue === "semaine")}`}
          >
            Semaine
          </Link>
        </div>
      </PageHeader>

      <FiltreActivites
        base="/seances/calendrier"
        selection={activite}
        activites={activites}
        params={{ vue, date: isoDate(ancre) }}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={lien(precedent)} className={btnNav} aria-label="Période précédente">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <Link href={lien(suivant)} className={btnNav} aria-label="Période suivante">
          <ChevronRight className="h-4 w-4" />
        </Link>
        <Link href={lien(aujourdhui())} className={btnSecondary}>
          Aujourd&apos;hui
        </Link>
        <h2 className="ml-2 text-lg font-semibold text-slate-800 first-letter:uppercase">
          {libelle}
        </h2>
      </div>

      <CalendrierSeances vue={vue} jours={jours} />

      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-sm text-slate-500">
          Une séance annulée reste visible, barrée avec son motif, et se rétablit
          depuis sa fiche. Pour une fermeture récurrente — vacances scolaires, jours
          fériés —, déclarez plutôt une période dans{" "}
          <Link href="/parametres/saisons" className="font-medium underline">
            Saisons &amp; calendrier
          </Link>
          {" "}: les séances n&apos;y sont pas créées du tout, et la période apparaît
          ici en fond ambré.
        </p>
      </div>
    </>
  );
}
