import { Inbox, Mail } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getGeneralSettings } from "@/lib/settings";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { DemandeAccesActions } from "@/components/demande-acces-actions";
import { fmtHorodatage } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * File des demandes d'accès déposées depuis Internet.
 *
 * C'est l'écran qui rend le formulaire public acceptable : une demande n'ouvre
 * aucun droit tant qu'un gestionnaire n'a pas tranché ici. Le traité récent
 * reste affiché — sans lui, on ne saurait pas si une demande a été traitée ou
 * si elle s'est perdue.
 */
export default async function DemandesAccesPage() {
  await requireUser("GESTIONNAIRE");
  const g = await getGeneralSettings();

  const [enAttente, traitees] = await Promise.all([
    prisma.demandeAcces.findMany({
      where: { statut: "EN_ATTENTE" },
      orderBy: { createdAt: "asc" }, // la plus ancienne d'abord : elle attend depuis le plus longtemps
    }),
    prisma.demandeAcces.findMany({
      where: { statut: { not: "EN_ATTENTE" } },
      orderBy: { decideAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Demandes d'accès"
        subtitle="Personnes absentes de l'annuaire qui demandent un accès aux activités. Valider crée leur compte ; tant que vous n'avez pas tranché, elles n'ont aucun droit."
      />

      {!g.demandeAccesActive && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5">
          <p className="text-sm font-semibold text-amber-800">
            Le formulaire public est désactivé
          </p>
          <p className="mt-1 text-sm text-amber-700">
            Les demandes déjà déposées restent à traiter ci-dessous, mais plus
            aucune nouvelle ne peut arriver. Activez-le dans{" "}
            <Link href="/parametres" className="font-medium underline">
              Paramètres → Général
            </Link>
            .
          </p>
        </div>
      )}

      {enAttente.length === 0 ? (
        <EmptyState
          title="Aucune demande en attente"
          hint="Les demandes déposées depuis Internet apparaissent ici."
        />
      ) : (
        <div className="space-y-4">
          {enAttente.map((d) => (
            <Card key={d.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{d.nom}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    <a href={`mailto:${d.email}`} className="truncate hover:underline">
                      {d.email}
                    </a>
                  </p>
                  {d.service && (
                    <p className="mt-0.5 text-sm text-slate-500">{d.service}</p>
                  )}
                </div>
                <span className="text-xs text-slate-400">
                  Déposée le {fmtHorodatage(d.createdAt)}
                  {/* L'IP n'est pas décorative : plusieurs demandes de la même
                      adresse trahissent un dépôt automatisé plutôt qu'une
                      rentrée chargée. */}
                  {d.ip ? ` · ${d.ip}` : ""}
                </span>
              </div>

              {d.message && (
                <p className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                  {d.message}
                </p>
              )}

              <div className="mt-4">
                <DemandeAccesActions id={d.id} nom={d.nom} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {traitees.length > 0 && (
        <Card title="Demandes traitées" className="mt-8">
          <ul className="divide-y divide-slate-100 text-sm">
            {traitees.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <Inbox className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                <span className="font-medium">{d.nom}</span>
                <span className="min-w-0 truncate text-slate-400">{d.email}</span>
                <Badge
                  color={
                    d.statut === "VALIDEE"
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                      : "bg-slate-100 text-slate-600 ring-slate-500/20"
                  }
                >
                  {d.statut === "VALIDEE" ? "Accès ouvert" : "Refusée"}
                </Badge>
                <span className="ml-auto text-xs text-slate-400">
                  {d.decidePar ? `${d.decidePar} · ` : ""}
                  {fmtHorodatage(d.decideAt)}
                  {d.motif ? ` · ${d.motif}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
