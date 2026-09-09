import Link from "next/link";
import { Archive, ChevronRight, Plus, RotateCcw, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import {
  Badge,
  Card,
  EmptyState,
  Jauge,
  PageHeader,
  btnPrimary,
  btnSecondary,
} from "@/components/ui";
import { FiltreActivites } from "@/components/filtre-activites";
import { fmtDate, JOUR_LABELS } from "@/lib/dates";
import { effectifsParActivite } from "@/lib/inscriptions";
import { pluriel } from "@/lib/constants";
import { restaurerActivite } from "@/lib/actions/activites";
import { BoutonAction } from "@/components/bouton-action";

/**
 * Liste des activités.
 *
 * Volontairement en lecture seule : tout ce qui concerne une activité — sa
 * fiche, ses créneaux, leurs animateurs et leurs vacances — se gère sur sa
 * propre page. Mélanger la liste et les formulaires obligeait à découper
 * l'écran, et un créneau appartient toujours à une activité : il n'a pas à se
 * créer depuis un formulaire séparé.
 */
export default async function ActivitesPage({
  searchParams,
}: {
  searchParams: Promise<{ activite?: string }>;
}) {
  await requireUser("GESTIONNAIRE");
  const { activite: selection } = await searchParams;
  const saison = await saisonCourante();

  if (!saison) {
    return (
      <>
        <PageHeader title="Activités & créneaux" />
        <EmptyState
          title="Créez d'abord une saison"
          hint="Les créneaux sont rattachés à une saison sportive."
        />
        <div className="mt-4">
          <Link href="/parametres/saisons" className={btnSecondary}>
            Aller aux saisons
          </Link>
        </div>
      </>
    );
  }

  const [activites, archivees, nbFermetures, effectifs] = await Promise.all([
    prisma.activite.findMany({
      where: { archiveAt: null },
      // Alphabétique : « ordre » n'est que le rang de création, qu'aucun écran
      // ne permet de changer, et personne ne retrouve une activité à ce rang.
      orderBy: [{ actif: "desc" }, { nom: "asc" }],
      include: {
        creneaux: {
          where: { saisonId: saison.id, archiveAt: null },
          orderBy: [{ jour: "asc" }, { heureDebut: "asc" }],
          include: {
            animateurs: { select: { id: true, nom: true, prenom: true } },
            fermeturesMaintenues: { select: { id: true } },
            _count: {
              select: {
                seances: true,
                inscriptions: { where: { statut: "VALIDEE" } },
              },
            },
          },
        },
      },
    }),
    // Retirées du service, mais toujours comptées : elles reparaissent ici
    // seulement, avec de quoi revenir en arrière.
    prisma.activite.findMany({
      where: { archiveAt: { not: null } },
      orderBy: { archiveAt: "desc" },
      select: { id: true, nom: true, couleur: true, archiveAt: true },
    }),
    prisma.fermeture.count({ where: { saisonId: saison.id } }),
    effectifsParActivite(saison.id),
  ]);

  const affichees = selection ? activites.filter((a) => a.id === selection) : activites;

  return (
    <>
      <PageHeader
        title="Activités & créneaux"
        subtitle={`Saison ${saison.nom} — un créneau par séance hebdomadaire`}
      >
        <Link href="/activites/nouvelle" className={btnPrimary}>
          <Plus className="h-4 w-4" /> Nouvelle activité
        </Link>
      </PageHeader>

      <FiltreActivites
        base="/activites"
        selection={selection}
        activites={activites.map((a) => ({
          id: a.id,
          nom: a.nom,
          couleur: a.couleur,
          actif: a.actif,
        }))}
      />

      {activites.length === 0 ? (
        <EmptyState
          title="Aucune activité"
          hint="Commencez par créer vos activités, puis leurs créneaux hebdomadaires."
        />
      ) : (
        <div className="space-y-4">
          {affichees.map((a) => {
            // Groupe unique : le remplissage se lit sur l'activité, chaque
            // créneau n'affichant plus que l'effectif attendu à sa séance.
            const groupe = a.capacitePartagee
              ? { capacite: a.capacite ?? 0, inscrits: effectifs.get(a.id) ?? 0 }
              : null;
            return (
            <Card
              key={a.id}
              className={`border-l-4 ${a.actif ? "" : "opacity-60"}`}
              style={{ borderLeftColor: a.couleur }}
            >
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: a.couleur }}
                    />
                    <h2
                      className="text-lg font-semibold tracking-tight"
                      style={{ color: a.couleur }}
                    >
                      {a.nom}
                    </h2>
                    {!a.actif && <Badge>Désactivée</Badge>}
                  </div>
                  {a.description && (
                    <p className="mt-1.5 text-sm text-slate-500">{a.description}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    {a.creneaux.length}{" "}
                    {pluriel(a.creneaux.length, "créneau", "créneaux")} cette saison
                    {groupe && " · groupe unique, places partagées"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  {groupe && (
                    <div className="w-40">
                      <p className="mb-1 flex items-center gap-1.5 text-xs tabular-nums text-slate-500">
                        <Users className="h-3.5 w-3.5" />
                        {groupe.inscrits} / {groupe.capacite} agents
                      </p>
                      <Jauge
                        valeur={
                          groupe.capacite > 0
                            ? (groupe.inscrits / groupe.capacite) * 100
                            : 0
                        }
                        couleur={a.couleur}
                      />
                    </div>
                  )}
                  <Link href={`/activites/${a.id}`} className={btnSecondary}>
                    Gérer l&apos;activité <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              {a.creneaux.length === 0 ? (
                <Link
                  href={`/activites/${a.id}`}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 transition hover:bg-slate-50"
                >
                  <Plus className="h-4 w-4" /> Aucun créneau — en ajouter un
                </Link>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {a.creneaux.map((c) => {
                    const inscrits = c._count.inscriptions;
                    return (
                      <li
                        key={c.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">
                            {JOUR_LABELS[c.jour]} {c.heureDebut}–{c.heureFin}
                          </p>
                          <p className="truncate text-xs text-slate-400">
                            {[
                              c.lieu,
                              c.animateurs.length > 0
                                ? c.animateurs
                                    .map((an) => `${an.prenom} ${an.nom}`)
                                    .join(", ")
                                : "animateur à désigner",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {nbFermetures > 0 && (
                            <p className="text-xs">
                              {c.fermeturesMaintenues.length === 0 ? (
                                <span className="text-slate-400">
                                  fermé pendant les vacances
                                </span>
                              ) : c.fermeturesMaintenues.length === nbFermetures ? (
                                <span className="text-emerald-700">
                                  ouvert toute l&apos;année
                                </span>
                              ) : (
                                <span className="text-emerald-700">
                                  ouvert sur {c.fermeturesMaintenues.length} des{" "}
                                  {nbFermetures} périodes de vacances
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-4">
                          <span className="flex items-center gap-1.5 text-xs tabular-nums text-slate-500">
                            <Users className="h-3.5 w-3.5" />
                            {groupe ? inscrits : `${inscrits} / ${c.capacite}`}
                          </span>
                          {!groupe && (
                            <div className="w-24">
                              <Jauge
                                valeur={(inscrits / c.capacite) * 100}
                                couleur={a.couleur}
                              />
                            </div>
                          )}
                          {!c.ouvertInscription && <Badge>Inscriptions fermées</Badge>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {a.creneaux.length > 0 && (
                <Link
                  href={`/activites/${a.id}?nouveau=1#nouveau`}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-800"
                >
                  <Plus className="h-3.5 w-3.5" /> Ajouter un créneau à {a.nom}
                </Link>
              )}
            </Card>
            );
          })}
        </div>
      )}

      {archivees.length > 0 && !selection && (
        <Card className="mt-6" title="Activités retirées">
          <p className="mb-3 text-sm text-slate-500">
            Elles ne sont plus proposées et n&apos;apparaissent plus au planning.
            Leur fréquentation reste comptée dans les statistiques des saisons
            où elles ont eu lieu.
          </p>
          <ul className="divide-y divide-slate-100">
            {archivees.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm"
              >
                <span className="flex items-center gap-2.5">
                  <Archive className="h-3.5 w-3.5 text-slate-400" />
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: a.couleur }}
                  />
                  <span className="font-medium text-slate-600">{a.nom}</span>
                  <span className="text-xs text-slate-400">
                    retirée le {fmtDate(a.archiveAt)}
                  </span>
                </span>
                <BoutonAction
                  action={restaurerActivite.bind(null, a.id)}
                  confirmation={`Remettre « ${a.nom} » en service, avec ses créneaux ?`}
                  className={btnSecondary}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Restaurer
                </BoutonAction>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
