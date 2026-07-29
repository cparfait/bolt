import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { prisma } from "@/lib/db";
import { estGestionnaire, requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import { ajouterJours, aujourdhui, fmtJourCourt, isoDate, jourUtc } from "@/lib/dates";
import { Card, EmptyState, PageHeader, Select, Input } from "@/components/ui";
import { FiltreForm } from "@/components/filtre-form";
import { AnnulationGroupee } from "@/components/annulation-groupee";

/**
 * Annulation anticipée de séances.
 *
 * Le service des sports sait souvent à l'avance qu'une série de séances tombe :
 * piscine fermée pour vidange, gymnase réquisitionné pour un scrutin, animateur
 * en arrêt. Le faire séance par séance depuis chaque fiche est fastidieux et
 * surtout, cela envoie un courriel par séance à chaque inscrit.
 *
 * Une fermeture durable et prévue de longue date — les vacances scolaires —
 * relève plutôt des périodes de fermeture de la saison, qui retirent les
 * séances du calendrier au lieu de les annuler une à une.
 */
export default async function AnnulerSeancesPage({
  searchParams,
}: {
  searchParams: Promise<{ activite?: string; creneau?: string; du?: string; au?: string }>;
}) {
  const user = await requireUser("GESTIONNAIRE", "COACH");
  const { activite, creneau, du, au } = await searchParams;
  const saison = await saisonCourante();

  if (!saison) {
    return (
      <>
        <PageHeader title="Annuler des séances" />
        <EmptyState title="Aucune saison configurée" />
      </>
    );
  }

  // Un animateur ne voit et n'annule que ses propres créneaux.
  let coachId: string | undefined;
  if (!estGestionnaire(user)) {
    const coach = await prisma.coach.findUnique({ where: { userId: user.id } });
    if (!coach) {
      return (
        <>
          <PageHeader title="Annuler des séances" />
          <EmptyState
            title="Aucun créneau ne vous est rattaché"
            hint="Le service des sports doit vous associer à un créneau."
          />
        </>
      );
    }
    coachId = coach.id;
  }
  const perimetre = coachId ? { animateurs: { some: { id: coachId } } } : {};

  // Par défaut, les deux prochains mois : assez large pour couvrir une
  // fermeture annoncée, assez court pour que la liste reste lisible.
  const debut = du ? jourUtc(du) : aujourdhui();
  const fin = au ? jourUtc(au) : ajouterJours(aujourdhui(), 60);

  const [seances, creneaux] = await Promise.all([
    prisma.seance.findMany({
      where: {
        statut: "PLANIFIEE",
        // Seules les séances à venir : cet écran sert à prévenir, pas à
        // constater après coup — cela se fait sur la fiche de la séance.
        date: { gte: aujourdhui() > debut ? aujourdhui() : debut, lte: fin },
        creneau: {
          saisonId: saison.id,
          ...perimetre,
          ...(creneau ? { id: creneau } : {}),
          ...(activite ? { activiteId: activite } : {}),
        },
      },
      include: {
        creneau: {
          include: {
            activite: { select: { nom: true, couleur: true } },
            _count: { select: { inscriptions: { where: { statut: "VALIDEE" } } } },
          },
        },
      },
      orderBy: [{ date: "asc" }, { creneau: { heureDebut: "asc" } }],
      take: 300,
    }),
    prisma.creneau.findMany({
      where: { saisonId: saison.id, ...perimetre },
      include: { activite: { select: { id: true, nom: true } } },
      orderBy: [{ activite: { nom: "asc" } }, { jour: "asc" }, { heureDebut: "asc" }],
    }),
  ]);

  const activites = [
    ...new Map(creneaux.map((c) => [c.activite.id, c.activite])).values(),
  ];
  // Le second menu se restreint à l'activité choisie : proposer les créneaux
  // des autres n'aurait aucun effet.
  const creneauxProposes = activite
    ? creneaux.filter((c) => c.activite.id === activite)
    : creneaux;

  return (
    <>
      <Link
        href="/seances"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Retour au planning
      </Link>

      <PageHeader
        title="Annuler des séances"
        subtitle="Prévenir à l'avance que des séances n'auront pas lieu"
      />

      <Card title="Séances concernées" className="mb-6">
        <FiltreForm className="mb-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Activité</span>
            <Select name="activite" defaultValue={activite ?? ""} className="w-auto">
              <option value="">Toutes les activités</option>
              {activites.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nom}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Créneau</span>
            <Select name="creneau" defaultValue={creneau ?? ""} className="w-auto">
              <option value="">Tous les créneaux</option>
              {creneauxProposes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.activite.nom} — {c.jour.toLowerCase()} {c.heureDebut}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Du</span>
            <Input
              type="date"
              name="du"
              defaultValue={du ?? isoDate(aujourdhui())}
              className="w-auto"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Au</span>
            <Input
              type="date"
              name="au"
              defaultValue={au ?? isoDate(ajouterJours(aujourdhui(), 60))}
              className="w-auto"
            />
          </label>
        </FiltreForm>

        {seances.length === 0 ? (
          <EmptyState
            title="Aucune séance à venir sur cette période"
            hint="Élargissez les dates ou changez d'activité."
          />
        ) : (
          <AnnulationGroupee
            seances={seances.map((s) => ({
              id: s.id,
              jour: fmtJourCourt(s.date),
              horaire: `${s.creneau.heureDebut}–${s.creneau.heureFin}`,
              activite: s.creneau.activite.nom,
              couleur: s.creneau.activite.couleur,
              lieu: s.creneau.lieu,
              inscrits: s.creneau._count.inscriptions,
            }))}
          />
        )}
      </Card>

      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-sm text-slate-500">
          Une séance annulée reste au planning, barrée et accompagnée de son motif :
          l&apos;agent comprend pourquoi elle a disparu de son agenda. Elle se rétablit
          depuis sa fiche. Pour une fermeture récurrente — vacances scolaires, jours
          fériés —, déclarez plutôt une période dans{" "}
          <Link href="/parametres/saisons" className="font-medium underline">
            Saisons &amp; calendrier
          </Link>
          {" "}: les séances ne sont alors pas créées du tout.
        </p>
      </div>
    </>
  );
}
