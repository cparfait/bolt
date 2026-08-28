import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { fmtHorodatage } from "@/lib/dates";
import {
  compterAPurger,
  JOURS_CONSERVATION_IP,
  JOURS_CONSERVATION_JOURNAL,
} from "@/lib/purge";
import { getGeneralSettings } from "@/lib/settings";
import { Card, EmptyState, PageHeader, Select, btnSecondary } from "@/components/ui";
import { FiltreForm } from "@/components/filtre-form";
import { PurgeForm } from "@/components/purge-form";

const PAGE = 100;

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  await requireUser("ADMIN");
  const { action, page: pageBrute } = await searchParams;
  const page = Math.max(1, Number(pageBrute) || 1);

  const [lignes, total, actions] = await Promise.all([
    prisma.auditLog.findMany({
      where: action ? { action } : {},
      include: { user: { select: { displayName: true, login: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
    prisma.auditLog.count({ where: action ? { action } : {} }),
    prisma.auditLog.groupBy({ by: ["action"], _count: true, orderBy: { action: "asc" } }),
  ]);

  const pages = Math.ceil(total / PAGE);

  // Le journal se purge tout seul ; les inscriptions et les présences, non —
  // c'est un effacement irréversible qui doit rester un geste délibéré.
  const g = await getGeneralSettings();
  const aPurger = g.conservationMois > 0 ? await compterAPurger(g.conservationMois) : null;

  return (
    <>
      {/* La durée de conservation est affichée, et pas seulement appliquée : le
          journal contient des adresses IP, et qui le consulte doit savoir ce
          qu'il advient de ces données — c'est aussi ce qu'un délégué à la
          protection des données vient vérifier en premier. */}
      <PageHeader
        title="Journal"
        subtitle={`${total} événements — connexions, émargements, décisions. Les adresses IP sont effacées après ${JOURS_CONSERVATION_IP} jours, les lignes après ${JOURS_CONSERVATION_JOURNAL} jours.`}
      >
        <FiltreForm>
          <Select name="action" defaultValue={action ?? ""} className="w-auto">
            <option value="">Toutes les actions</option>
            {actions.map((a) => (
              <option key={a.action} value={a.action}>
                {a.action} ({a._count})
              </option>
            ))}
          </Select>
        </FiltreForm>
      </PageHeader>

      {aPurger && (
        <Card title="Conservation des inscriptions et des présences" className="mb-6">
          <PurgeForm
            mois={g.conservationMois}
            inscriptions={aPurger.inscriptions}
            presences={aPurger.presences}
            saisons={aPurger.saisons}
            seuil={aPurger.seuil.toLocaleDateString("fr-FR")}
          />
        </Card>
      )}

      {lignes.length === 0 ? (
        <EmptyState title="Aucun événement" />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Action</th>
                  <th className="pb-2 font-medium">Acteur</th>
                  <th className="pb-2 font-medium">Cible</th>
                  <th className="pb-2 font-medium">Détail</th>
                  <th className="pb-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lignes.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap py-2 pr-3 text-slate-500 tabular-nums">
                      {fmtHorodatage(l.createdAt)}
                    </td>
                    <td className="py-2 pr-3 font-medium">{l.action}</td>
                    <td className="py-2 pr-3 text-slate-600">
                      {l.user?.displayName ?? l.acteur ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{l.cible ?? "—"}</td>
                    <td className="py-2 pr-3 text-slate-400">{l.details ?? "—"}</td>
                    <td className="py-2 text-slate-400 tabular-nums">{l.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-slate-400">
                Page {page} sur {pages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <a
                    href={`/parametres/journal?page=${page - 1}${action ? `&action=${action}` : ""}`}
                    className={btnSecondary}
                  >
                    Précédent
                  </a>
                )}
                {page < pages && (
                  <a
                    href={`/parametres/journal?page=${page + 1}${action ? `&action=${action}` : ""}`}
                    className={btnSecondary}
                  >
                    Suivant
                  </a>
                )}
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
