import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import { Badge, Card, EmptyState, Input, PageHeader, btnSecondary } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/constants";

/**
 * Recherche d'agents, atterrissage de la barre du tableau de bord.
 *
 * Ne couvre que les comptes Bolt : chercher un agent revient à consulter sa
 * fréquentation, ce qui n'a de sens que s'il a un historique. La recherche
 * dans l'annuaire, elle, sert à *inscrire* quelqu'un — c'est un autre besoin,
 * traité sur la page des inscriptions.
 */
export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireUser("GESTIONNAIRE");
  const { q } = await searchParams;
  const terme = (q ?? "").trim();
  const saison = await saisonCourante();

  const agents =
    terme.length >= 2
      ? await prisma.user.findMany({
          where: {
            OR: [
              { displayName: { contains: terme, mode: "insensitive" } },
              { login: { contains: terme, mode: "insensitive" } },
              { email: { contains: terme, mode: "insensitive" } },
              { service: { contains: terme, mode: "insensitive" } },
              { direction: { contains: terme, mode: "insensitive" } },
            ],
          },
          orderBy: { displayName: "asc" },
          take: 50,
          include: {
            _count: {
              select: {
                inscriptions: { where: { statut: "VALIDEE" } },
                presences: { where: { etat: "PRESENT" } },
              },
            },
          },
        })
      : [];

  return (
    <>
      <PageHeader
        title="Rechercher un agent"
        subtitle={
          saison
            ? `Inscriptions et assiduité — saison ${saison.nom}`
            : "Inscriptions et assiduité"
        }
      />

      <Card className="mb-6">
        <form className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              name="q"
              defaultValue={terme}
              autoFocus
              placeholder="Nom, identifiant, e-mail, service ou direction"
              className="pl-9"
            />
          </div>
          <button type="submit" className={btnSecondary}>
            Rechercher
          </button>
        </form>
      </Card>

      {terme.length < 2 ? (
        <EmptyState
          title="Saisissez au moins deux caractères"
          hint="La recherche porte sur le nom, l'identifiant, l'adresse e-mail, le service et la direction."
        />
      ) : agents.length === 0 ? (
        <EmptyState
          title={`Aucun agent ne correspond à « ${terme} »`}
          hint="Un agent n'apparaît ici qu'après sa première connexion ou une inscription faite pour lui."
        />
      ) : (
        <Card title={`${agents.length} résultat${agents.length > 1 ? "s" : ""}`}>
          <ul className="divide-y divide-slate-100">
            {agents.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/agents/${a.id}`}
                  className="flex items-center justify-between gap-3 py-3 transition hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {a.displayName}
                      {!a.active && (
                        <span className="ml-2">
                          <Badge>Désactivé</Badge>
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {[a.login, a.service ?? a.direction, a.email]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                    <span className="tabular-nums">
                      {a._count.inscriptions} inscription
                      {a._count.inscriptions > 1 ? "s" : ""}
                    </span>
                    <span className="tabular-nums">
                      {a._count.presences} présence
                      {a._count.presences > 1 ? "s" : ""}
                    </span>
                    <Badge>{ROLE_LABELS[a.role]}</Badge>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
