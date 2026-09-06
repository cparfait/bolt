import Link from "next/link";
import { Building2, Power, Trash2 } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getGeneralSettings } from "@/lib/settings";
import { basculerService, supprimerService } from "@/lib/actions/services";
import { Badge, Card, EmptyState } from "@/components/ui";
import { Panneau } from "@/components/panneau";
import { BoutonAction } from "@/components/bouton-action";
import { ImportServicesAnnuaire, ServiceForm } from "@/components/service-form";
import { RapprochementService } from "@/components/rapprochement-service";
import { ecartsDeRattachement } from "@/lib/rapprochement";
import { pluriel } from "@/lib/constants";

/**
 * Référentiel des services de la collectivité.
 *
 * Il alimente le bon d'inscription — la liste que voit une personne absente de
 * l'annuaire — et les suggestions du gestionnaire au moment de valider sa
 * demande. Il ne touche pas au rattachement des comptes d'annuaire, lu dans
 * l'AD et réécrit à chaque synchronisation.
 */
export default async function ParametresServices({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  await requireUser("GESTIONNAIRE");
  const { service: enEdition } = await searchParams;
  const g = await getGeneralSettings();

  const services = await prisma.service.findMany({
    orderBy: [{ actif: "desc" }, { ordre: "asc" }, { nom: "asc" }],
  });
  const ecarts = await ecartsDeRattachement();
  const proposables = services.filter((s) => s.actif).map((s) => s.nom);

  // Nombre de comptes rattachés à chaque libellé : dit ce qui sert réellement,
  // et conditionne la suppression.
  const comptes = await prisma.user.groupBy({ by: ["service"], _count: true });
  const usages = new Map(
    comptes.filter((c) => c.service).map((c) => [c.service as string, c._count]),
  );

  return (
    <div className="space-y-6">
      <Card title={`Services (${services.length})`}>
        {services.length === 0 ? (
          <EmptyState
            title="Aucun service déclaré"
            hint="Tant que la liste est vide, le bon d'inscription laisse la personne écrire son service à la main."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {services.map((s) => {
              const utilise = usages.get(s.nom) ?? 0;
              return (
                <li key={s.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
                        {s.nom}
                        {!s.actif && <Badge>Retiré</Badge>}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {utilise > 0
                          ? `${utilise} ${pluriel(utilise, "personne rattachée", "personnes rattachées")}`
                          : "personne rattachée"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Link
                        href={
                          enEdition === s.id
                            ? "/parametres/services"
                            : `/parametres/services?service=${s.id}#edition`
                        }
                        scroll={false}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                          enEdition === s.id
                            ? "border-brand-300 bg-brand-50 text-brand-700"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {enEdition === s.id ? "Fermer" : "Renommer"}
                      </Link>
                      <BoutonAction
                        action={basculerService.bind(null, s.id)}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-500 transition hover:bg-slate-50"
                        title={
                          s.actif ? "Retirer du bon d'inscription" : "Remettre dans la liste"
                        }
                      >
                        <Power className="h-3.5 w-3.5" />
                      </BoutonAction>
                      {utilise === 0 && (
                        <BoutonAction
                          action={supprimerService.bind(null, s.id)}
                          confirmation={`Supprimer définitivement « ${s.nom} » ?`}
                          className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                          title="Supprimer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </BoutonAction>
                      )}
                    </div>
                  </div>

                  {enEdition === s.id && (
                    <div
                      id="edition"
                      className="mt-4 scroll-mt-20 rounded-xl border-2 border-brand-200 bg-brand-50/30 p-5"
                    >
                      <ServiceForm initial={{ id: s.id, nom: s.nom }} />
                      {utilise > 0 && (
                        <p className="mt-3 text-xs text-slate-500">
                          Renommer ce service met à jour les {utilise}{" "}
                          {pluriel(utilise, "personne", "personnes")} qui le portent.
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
        titre="Ajouter un service"
        sousTitre="Direction, service, organisme rattaché…"
        ouvert={services.length === 0}
      >
        <ServiceForm />
      </Panneau>

      <Card title="Reprendre l'existant">
        <ImportServicesAnnuaire />
      </Card>

      {/* Le rapprochement, sans quoi la liste fermée ne règle que l'avenir : les
          comptes déjà créés portent ce qui a été tapé avant, et ce sont eux qui
          font diverger la fréquentation par direction. */}
      {ecarts.length > 0 && (
        <Card
          title={`Rattachements à reprendre (${ecarts.length})`}
          className="border-amber-200"
        >
          <p className="mb-3 text-sm text-slate-500">
            Ces libellés sont portés par des comptes mais ne figurent pas dans le
            référentiel. Tant qu&apos;ils subsistent, la fréquentation par
            service se répartit sur autant de lignes que d&apos;orthographes.
          </p>
          {proposables.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
              Déclarez d&apos;abord au moins un service : il n&apos;y a rien à
              quoi les rattacher.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {ecarts.map((e) => (
                <RapprochementService
                  key={e.libelle}
                  libelle={e.libelle}
                  horsAnnuaire={e.horsAnnuaire}
                  annuaire={e.annuaire}
                  services={proposables}
                />
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="space-y-2 text-xs text-slate-500">
        <p>
          Cette liste est proposée sur le bon d&apos;inscription, à la personne
          qui demande un accès sans figurer dans l&apos;annuaire
          {g.demandeAccesActive ? "" : " — formulaire actuellement désactivé dans Paramètres → Général"}
          . Un service retiré n&apos;y est plus proposé, mais reste affiché sur
          les fiches qui le portent. La suppression définitive n&apos;est
          possible que si plus personne n&apos;y est rattaché.
        </p>
        <p>
          Le rattachement des comptes de l&apos;annuaire ne se règle pas ici : il
          est lu dans l&apos;Active Directory (<code>department</code> et{" "}
          <code>division</code>) et réécrit à chaque synchronisation. Le corriger
          dans Bolt ne tiendrait pas jusqu&apos;au lendemain.
        </p>
      </div>
    </div>
  );
}
