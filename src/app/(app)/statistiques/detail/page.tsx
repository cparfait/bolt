import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import { fmtDate } from "@/lib/dates";
import { detail, TYPES_COUPE, type Coupe } from "@/lib/stats-detail";
import { INSCRIPTION_STATUT_COLORS, INSCRIPTION_STATUT_LABELS } from "@/lib/constants";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Le détail d'un chiffre des statistiques.
 *
 * Un écran unique pour toutes les coupes, et non un écran par indicateur : ce
 * sont toujours les mêmes trois listes — des agents, des séances, des
 * demandes —, et les multiplier aurait donné sept pages presque identiques
 * qu'il aurait fallu tenir d'accord entre elles.
 *
 * Le retour ramène sur la vue exacte d'où l'on vient, filtre et saison
 * compris : arriver ici puis devoir refaire son filtre à la main rendrait le
 * détour plus coûteux que l'export qu'il remplace.
 */
export default async function DetailStatistiques({
  searchParams,
}: {
  searchParams: Promise<{
    saison?: string;
    activite?: string;
    vue?: string;
    type?: string;
    valeur?: string;
  }>;
}) {
  await requireUser("GESTIONNAIRE");
  const p = await searchParams;
  const type = p.type ?? "";
  const valeur = p.valeur ?? "";
  if (!TYPES_COUPE.includes(type as (typeof TYPES_COUPE)[number]) || !valeur) notFound();

  const courante = await saisonCourante();
  const saison = p.saison
    ? await prisma.saison.findUnique({ where: { id: p.saison } })
    : courante;
  if (!saison) notFound();

  const filtre = { saisonId: saison.id, activiteId: p.activite || undefined };
  const d = await detail(filtre, { type, valeur } as Coupe);

  // Le chemin du retour, reconstruit à l'identique.
  const params = new URLSearchParams({ saison: saison.id });
  if (p.activite) params.set("activite", p.activite);
  if (p.vue && p.vue !== "bilan") params.set("vue", p.vue);
  const retour = `/statistiques?${params.toString()}`;

  const rien =
    d.agents.length === 0 && d.seances.length === 0 && d.inscriptions.length === 0;

  return (
    <>
      <Link
        href={retour}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux statistiques
      </Link>

      <PageHeader title={d.titre} subtitle={`${d.sousTitre} — saison ${saison.nom}`} />

      {rien && (
        <EmptyState
          title="Rien à détailler ici"
          hint="Ce total est à zéro sur le périmètre affiché, ou les données qui le composaient ont changé depuis."
        />
      )}

      {d.agents.length > 0 && (
        <Card
          title={`Agents (${d.agents.length})`}
          className="mb-6"
          action={
            <span className="text-xs text-slate-400">
              Cliquez un nom pour ouvrir sa fiche
            </span>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2 font-medium">Agent</th>
                  <th className="pb-2 font-medium">Service</th>
                  <th className="pb-2 text-right font-medium">Venues</th>
                  <th className="pb-2 text-right font-medium">Proposées</th>
                  <th className="pb-2 text-right font-medium">Assiduité</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.agents.map((a) => (
                  <tr key={a.userId}>
                    <td className="py-2.5 font-medium">
                      <Link href={`/agents/${a.userId}`} className="hover:text-brand-600">
                        {a.nom}
                      </Link>
                    </td>
                    <td className="py-2.5 text-slate-500">{a.situation ?? "—"}</td>
                    <td className="py-2.5 text-right tabular-nums">{a.venues}</td>
                    <td className="py-2.5 text-right tabular-nums text-slate-500">
                      {a.proposees}
                    </td>
                    {/* Un tiret et non 0 % : aucune séance proposée ne veut pas
                        dire une assiduité nulle, mais une assiduité inconnue. */}
                    <td className="py-2.5 text-right font-medium tabular-nums">
                      {a.taux === null ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        `${a.taux}%`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {d.seances.length > 0 && (
        <Card title={`Séances (${d.seances.length})`} className="mb-6">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Activité</th>
                  <th className="pb-2 font-medium">Créneau</th>
                  <th className="pb-2 text-right font-medium">Présents</th>
                  <th className="pb-2 text-right font-medium">Absents</th>
                  <th className="pb-2 text-right font-medium">Places</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.seances.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2.5 whitespace-nowrap">
                      {fmtDate(s.date)}
                      <span className="ml-2 text-xs text-slate-400">{s.statut}</span>
                      {s.motif && (
                        <span className="block text-xs text-slate-400">« {s.motif} »</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: s.couleur }}
                        />
                        {s.activite}
                      </span>
                    </td>
                    <td className="py-2.5 text-slate-500">{s.creneau}</td>
                    <td className="py-2.5 text-right tabular-nums">{s.presents}</td>
                    <td className="py-2.5 text-right tabular-nums text-slate-500">
                      {s.absents}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-slate-500">
                      {s.places}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {d.inscriptions.length > 0 && (
        <Card title={`Demandes (${d.inscriptions.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2 font-medium">Agent</th>
                  <th className="pb-2 font-medium">Service</th>
                  <th className="pb-2 font-medium">Créneau</th>
                  <th className="pb-2 text-right font-medium">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.inscriptions.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2.5 font-medium">
                      <Link href={`/agents/${i.userId}`} className="hover:text-brand-600">
                        {i.nom}
                      </Link>
                      {i.motif && (
                        <span className="block text-xs text-slate-400">« {i.motif} »</span>
                      )}
                    </td>
                    <td className="py-2.5 text-slate-500">{i.situation ?? "—"}</td>
                    <td className="py-2.5 text-slate-500">{i.creneau}</td>
                    <td className="py-2.5 text-right">
                      <Badge
                        color={
                          INSCRIPTION_STATUT_COLORS[
                            i.statut as keyof typeof INSCRIPTION_STATUT_COLORS
                          ]
                        }
                      >
                        {i.statut === "LISTE_ATTENTE" && i.rang
                          ? `${INSCRIPTION_STATUT_LABELS.LISTE_ATTENTE} n°${i.rang}`
                          : INSCRIPTION_STATUT_LABELS[
                              i.statut as keyof typeof INSCRIPTION_STATUT_LABELS
                            ]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.noteInscriptions && (
            <p className="mt-3 text-xs text-slate-400">{d.noteInscriptions}</p>
          )}
        </Card>
      )}
    </>
  );
}
