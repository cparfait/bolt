import Link from "next/link";
import { Building2, Power, Trash2, Unlink } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getGeneralSettings } from "@/lib/settings";
import {
  basculerService,
  retirerRegroupement,
  supprimerService,
} from "@/lib/actions/services";
import { Badge, Card, EmptyState } from "@/components/ui";
import { Panneau } from "@/components/panneau";
import { BoutonAction } from "@/components/bouton-action";
import {
  AppliquerRapprochements,
  CollageServices,
  ImportServicesAnnuaire,
  ServiceForm,
} from "@/components/service-form";
import { RapprochementService } from "@/components/rapprochement-service";
import { inventaireLibelles, rapprocher } from "@/lib/rapprochement";
import { pluriel } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * Référentiel des services, et rapprochement des libellés d'annuaire.
 *
 * Trois blocs, dans l'ordre où on s'en sert : la liste que la collectivité
 * reconnaît, les libellés qui n'y entrent pas encore, et les regroupements déjà
 * posés. Le second est le seul qui demande du travail — et c'est pour le rendre
 * faisable que le moteur y propose une cible avec son niveau de confiance.
 */
export default async function ParametresServices({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  await requireUser("GESTIONNAIRE");
  const { service: enEdition } = await searchParams;
  const g = await getGeneralSettings();

  const [services, regroupements, libelles] = await Promise.all([
    prisma.service.findMany({
      orderBy: [{ actif: "desc" }, { ordre: "asc" }, { nom: "asc" }],
    }),
    prisma.regroupementService.findMany({ orderBy: [{ cible: "asc" }, { source: "asc" }] }),
    inventaireLibelles(),
  ]);

  const proposables = services.filter((s) => s.actif).map((s) => s.nom);
  const suggestions = rapprocher(libelles, proposables);
  const surs = suggestions.filter((s) => s.confiance === "sure").length;

  // Effectif par service : dit ce qui sert réellement, et conditionne la
  // suppression.
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
              const agreges = regroupements.filter((r) => r.cible === s.nom).length;
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
                          ? `${utilise} ${pluriel(utilise, "personne", "personnes")}`
                          : "personne"}
                        {agreges > 0 &&
                          ` · ${agreges} ${pluriel(agreges, "libellé regroupé", "libellés regroupés")}`}
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
                          confirmation={`Supprimer définitivement « ${s.nom} » ?${
                            agreges > 0
                              ? ` Les ${agreges} regroupement(s) qui le visent seront retirés.`
                              : ""
                          }`}
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
                          {pluriel(utilise, "personne", "personnes")} qui le portent,
                          et les regroupements qui le visent.
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

      {/* Le rapprochement. Fermer la liste ne règle que l'avenir : les comptes
          déjà là portent ce que l'annuaire dit, et ce sont eux qui font diverger
          la fréquentation par service. */}
      {suggestions.length > 0 && (
        <Card
          title={`Libellés à rattacher (${suggestions.length})`}
          className="border-amber-200"
        >
          <p className="mb-3 text-sm text-slate-500">
            Ces libellés sont portés par des comptes sans figurer au référentiel.
            Le rattachement porte sur le libellé lui-même, pas sur les personnes :
            la synchronisation de l&apos;annuaire le rejoue au lieu de le défaire.
          </p>
          {proposables.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
              Déclarez d&apos;abord au moins un service : il n&apos;y a rien à
              quoi les rattacher.
            </p>
          ) : (
            <>
              <AppliquerRapprochements surs={surs} />
              <ul className="divide-y divide-slate-100">
                {suggestions.map((s) => (
                  <RapprochementService
                    key={s.libelle}
                    suggestion={s}
                    services={proposables}
                  />
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {regroupements.length > 0 && (
        <Card title={`Regroupements en vigueur (${regroupements.length})`}>
          <ul className="divide-y divide-slate-100 text-sm">
            {regroupements.map((r) => (
              <li key={r.source} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="text-slate-500">{r.source}</span>
                <span className="text-slate-300">→</span>
                <span className="font-medium">{r.cible}</span>
                <BoutonAction
                  action={retirerRegroupement.bind(null, r.source)}
                  className="ml-auto rounded-lg border border-slate-200 px-2 py-1.5 text-slate-500 transition hover:bg-slate-50"
                  title="Retirer ce regroupement"
                >
                  <Unlink className="h-3.5 w-3.5" />
                </BoutonAction>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Panneau
        titre="Ajouter des services"
        sousTitre="Un par un, ou par collage d'une liste"
        ouvert={services.length === 0}
      >
        <div className="space-y-6">
          <ServiceForm />
          <div className="border-t border-slate-100 pt-6">
            <CollageServices />
          </div>
          <div className="border-t border-slate-100 pt-6">
            <ImportServicesAnnuaire />
          </div>
        </div>
      </Panneau>

      <div className="space-y-2 text-xs text-slate-500">
        <p>
          Cette liste est proposée sur le bon d&apos;inscription, à la personne
          qui demande un accès sans figurer dans l&apos;annuaire
          {g.demandeAccesActive
            ? ""
            : " — formulaire actuellement désactivé dans Paramètres → Général"}
          . Un service retiré n&apos;y est plus proposé, mais reste affiché sur
          les fiches qui le portent. La suppression définitive n&apos;est
          possible que si plus personne n&apos;y est rattaché.
        </p>
        <p>
          Le service affiché sur une fiche est un résultat : le libellé brut de
          l&apos;annuaire (<code>department</code>), passé au travers des
          regroupements ci-dessus. Corriger une règle suffit donc à corriger
          tout le monde, et rien n&apos;est perdu — le libellé d&apos;origine
          reste dans le miroir de l&apos;annuaire.
        </p>
      </div>
    </div>
  );
}
