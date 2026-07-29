import Link from "next/link";
import { MapPin, Power, Trash2 } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { basculerLieu, supprimerLieu } from "@/lib/actions/lieux";
import { Badge, Card, EmptyState } from "@/components/ui";
import { Panneau } from "@/components/panneau";
import { BoutonAction } from "@/components/bouton-action";
import { LieuForm } from "@/components/lieu-form";
import { pluriel } from "@/lib/constants";

/**
 * Référentiel des lieux.
 *
 * Saisis librement sur chaque créneau, les mêmes équipements s'écrivaient de
 * plusieurs façons et aucun regroupement n'était possible. Ils se déclarent
 * désormais ici et se choisissent dans une liste.
 */
export default async function ParametresLieux({
  searchParams,
}: {
  searchParams: Promise<{ lieu?: string }>;
}) {
  await requireUser("GESTIONNAIRE");
  const { lieu: enEdition } = await searchParams;

  const lieux = await prisma.lieu.findMany({
    orderBy: [{ actif: "desc" }, { ordre: "asc" }, { nom: "asc" }],
  });

  // Nombre de créneaux portant chaque libellé : dit ce qui est réellement
  // utilisé, et conditionne la suppression.
  const creneaux = await prisma.creneau.groupBy({
    by: ["lieu"],
    _count: true,
  });
  const usages = new Map(
    creneaux.filter((c) => c.lieu).map((c) => [c.lieu as string, c._count]),
  );

  return (
    <div className="space-y-6">
      <Card title={`Lieux (${lieux.length})`}>
        {lieux.length === 0 ? (
          <EmptyState
            title="Aucun lieu déclaré"
            hint="Ajoutez vos gymnases, salles et bassins : ils seront proposés à la création des créneaux."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {lieux.map((l) => {
              const utilise = usages.get(l.nom) ?? 0;
              return (
                <li key={l.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                        {l.nom}
                        {!l.actif && <Badge>Retiré</Badge>}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {[
                          l.adresse,
                          utilise > 0
                            ? `${utilise} ${pluriel(utilise, "créneau", "créneaux")}`
                            : "aucun créneau",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {l.notes && (
                        <p className="mt-1 text-xs text-slate-500">{l.notes}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Link
                        href={
                          enEdition === l.id
                            ? "/parametres/lieux"
                            : `/parametres/lieux?lieu=${l.id}#edition`
                        }
                        scroll={false}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                          enEdition === l.id
                            ? "border-brand-300 bg-brand-50 text-brand-700"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {enEdition === l.id ? "Fermer" : "Modifier"}
                      </Link>
                      <BoutonAction
                        action={basculerLieu.bind(null, l.id)}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-500 transition hover:bg-slate-50"
                        title={l.actif ? "Retirer de la liste" : "Remettre dans la liste"}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </BoutonAction>
                      {utilise === 0 && (
                        <BoutonAction
                          action={supprimerLieu.bind(null, l.id)}
                          confirmation={`Supprimer définitivement « ${l.nom} » ?`}
                          className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                          title="Supprimer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </BoutonAction>
                      )}
                    </div>
                  </div>

                  {enEdition === l.id && (
                    <div
                      id="edition"
                      className="mt-4 scroll-mt-20 rounded-xl border-2 border-brand-200 bg-brand-50/30 p-5"
                    >
                      <LieuForm
                        initial={{
                          id: l.id,
                          nom: l.nom,
                          adresse: l.adresse,
                          notes: l.notes,
                        }}
                      />
                      {utilise > 0 && (
                        <p className="mt-3 text-xs text-slate-500">
                          Renommer ce lieu met à jour les {utilise}{" "}
                          {pluriel(utilise, "créneau", "créneaux")} qui le portent.
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Panneau
        titre="Ajouter un lieu"
        sousTitre="Gymnase, salle, bassin…"
        ouvert={lieux.length === 0}
      >
        <LieuForm />
      </Panneau>

      <p className="text-xs text-slate-500">
        Un lieu retiré n&apos;est plus proposé à la création d&apos;un créneau, mais
        reste affiché sur ceux qui l&apos;utilisent déjà et dans l&apos;historique.
        La suppression définitive n&apos;est possible que si aucun créneau ne le
        porte.
      </p>
    </div>
  );
}
