import { CalendarSync, CheckCircle2, Lock, Trash2 } from "lucide-react";
import { prisma } from "@/lib/db";
import {
  activerSaison,
  regenererSaison,
  supprimerFermeture,
  supprimerSaison,
} from "@/lib/actions/saisons";
import { Badge, Card, EmptyState, btnDanger, btnSecondary } from "@/components/ui";
import { Panneau } from "@/components/panneau";
import { BoutonAction } from "@/components/bouton-action";
import { FermetureForm, SaisonForm } from "@/components/saison-forms";
import { fmtDate, isoDate } from "@/lib/dates";
import { pluriel } from "@/lib/constants";

export default async function ParametresSaisons() {
  const saisons = await prisma.saison.findMany({
    orderBy: { debut: "desc" },
    include: {
      fermetures: {
        orderBy: { debut: "asc" },
        include: {
          creneauxMaintenus: {
            select: { id: true, activite: { select: { nom: true, couleur: true } } },
          },
        },
      },
      _count: { select: { creneaux: true } },
    },
  });

  return (
    <div className="space-y-6">
      <Panneau titre="Créer une saison" sousTitre="Par exemple septembre 2026 → juin 2027" ouvert={saisons.length === 0}>
        <SaisonForm />
      </Panneau>

      {saisons.length === 0 ? (
        <EmptyState
          title="Aucune saison"
          hint="La saison délimite le calendrier : c'est elle qui borne la génération des séances."
        />
      ) : (
        saisons.map((s) => (
          <Card key={s.id}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">Saison {s.nom}</h3>
                  {s.active && (
                    <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-500/20">
                      Active
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-slate-500">
                  {fmtDate(s.debut)} → {fmtDate(s.fin)} · {s._count.creneaux}{" "}
                  {pluriel(s._count.creneaux, "créneau", "créneaux")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!s.active && (
                  <BoutonAction
                    action={activerSaison.bind(null, s.id)}
                    className={btnSecondary}
                    confirmation="Activer cette saison ? C'est celle que verront les agents."
                  >
                    <CheckCircle2 className="h-4 w-4" /> Activer
                  </BoutonAction>
                )}
                <BoutonAction
                  action={regenererSaison.bind(null, s.id)}
                  className={btnSecondary}
                  title="Recalculer toutes les séances de la saison"
                >
                  <CalendarSync className="h-4 w-4" /> Regénérer le calendrier
                </BoutonAction>
                {/* Supprimable tant qu'aucun créneau ne s'y rattache : au-delà,
                    la cascade emporterait séances et présences. */}
                {s._count.creneaux === 0 ? (
                  <BoutonAction
                    action={supprimerSaison.bind(null, s.id)}
                    confirmation={
                      s.fermetures.length > 0
                        ? `Supprimer la saison ${s.nom} et ses ${s.fermetures.length} période(s) de fermeture ?`
                        : `Supprimer la saison ${s.nom} ?`
                    }
                    className={btnDanger}
                    title="Supprimer la saison"
                  >
                    <Trash2 className="h-4 w-4" /> Supprimer
                  </BoutonAction>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400"
                    title="Supprimez d'abord les créneaux de cette saison."
                  >
                    <Lock className="h-3.5 w-3.5" />
                    {s._count.creneaux} {pluriel(s._count.creneaux, "créneau", "créneaux")} — non supprimable
                  </span>
                )}
              </div>
            </div>

            <details className="mb-4">
              <summary className="cursor-pointer text-sm font-medium text-indigo-600">
                Modifier les dates
              </summary>
              <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                <SaisonForm
                  initiale={{
                    id: s.id,
                    nom: s.nom,
                    debut: isoDate(s.debut),
                    fin: isoDate(s.fin),
                  }}
                />
              </div>
            </details>

            <div className="rounded-xl border border-slate-200 p-4">
              <p className="mb-3 text-sm font-semibold">
                Périodes sans séance ({s.fermetures.length})
              </p>
              {s.fermetures.length === 0 ? (
                <p className="mb-4 text-sm text-slate-400">
                  Ajoutez les vacances scolaires et les jours fériés : les séances
                  correspondantes sont retirées du calendrier.
                </p>
              ) : (
                <ul className="mb-4 divide-y divide-slate-100 text-sm">
                  {s.fermetures.map((f) => (
                    <li key={f.id} className="flex items-start justify-between gap-3 py-2">
                      <span>
                        <span className="font-medium">{f.libelle}</span>
                        <span className="ml-2 text-slate-400">
                          {fmtDate(f.debut)} → {fmtDate(f.fin)}
                        </span>
                        {/* Ce qui tourne malgré la fermeture : l'information
                            que cherche le service des sports avant d'annoncer
                            « tout est fermé » aux agents. */}
                        {f.creneauxMaintenus.length > 0 ? (
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-emerald-700">
                              maintenu :
                            </span>
                            {[
                              ...new Map(
                                f.creneauxMaintenus.map((c) => [c.activite.nom, c.activite]),
                              ).values(),
                            ].map((act) => (
                              <span
                                key={act.nom}
                                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                                style={{
                                  backgroundColor: `${act.couleur}14`,
                                  color: act.couleur,
                                }}
                              >
                                {act.nom}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="mt-1 block text-xs text-slate-400">
                            toutes les activités sont interrompues
                          </span>
                        )}
                      </span>
                      <BoutonAction
                        action={supprimerFermeture.bind(null, f.id)}
                        confirmation="Supprimer cette période ? Les séances seront replanifiées."
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </BoutonAction>
                    </li>
                  ))}
                </ul>
              )}
              <FermetureForm saisonId={s.id} />
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
