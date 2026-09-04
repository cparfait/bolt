import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { prisma } from "@/lib/db";
import { mentionCompte } from "@/lib/comptes";
import { requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import { Badge, Card, EmptyState, Input, PageHeader, btnSecondary } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/constants";

/**
 * Annuaire des comptes, et atterrissage de la barre du tableau de bord.
 *
 * L'écran ne servait qu'à chercher : sans terme de recherche, il n'affichait
 * rien. On ne pouvait donc pas répondre à « qui a un compte ? », « combien de
 * comptes fermés traînent ? », ni retrouver quelqu'un dont on ne sait plus
 * écrire le nom — précisément les questions qu'on se pose devant une liste.
 *
 * Ne couvre que les comptes Bolt : consulter un agent revient à consulter sa
 * fréquentation, ce qui n'a de sens que s'il a un historique. La recherche dans
 * l'annuaire Active Directory, elle, sert à *inscrire* quelqu'un — c'est un
 * autre besoin, traité sur la page des inscriptions.
 */

/** Filtres proposés, dans l'ordre où on les consulte. */
const FILTRES = {
  actifs: { label: "Actifs", where: { active: true, anonymiseAt: null } },
  fermes: { label: "Accès fermés", where: { active: false, anonymiseAt: null } },
  supprimes: { label: "Identités supprimées", where: { anonymiseAt: { not: null } } },
  tous: { label: "Tous", where: {} },
} as const;

type Filtre = keyof typeof FILTRES;

/** Au-delà, la liste cesse d'être lisible : c'est la recherche qui prend le relais. */
const PLAFOND = 200;
export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; f?: string }>;
}) {
  await requireUser("GESTIONNAIRE");
  const { q, f } = await searchParams;
  const terme = (q ?? "").trim();
  const filtre: Filtre = f && f in FILTRES ? (f as Filtre) : "actifs";
  const saison = await saisonCourante();

  // La recherche porte sur TOUS les comptes, filtre compris : chercher
  // quelqu'un dont on ne sait plus s'il est encore là ne doit pas renvoyer
  // « aucun résultat » parce qu'on se trouvait sur le mauvais onglet.
  const where = terme.length >= 2
    ? {
        OR: [
          { displayName: { contains: terme, mode: "insensitive" as const } },
          { login: { contains: terme, mode: "insensitive" as const } },
          { email: { contains: terme, mode: "insensitive" as const } },
          { service: { contains: terme, mode: "insensitive" as const } },
          { direction: { contains: terme, mode: "insensitive" as const } },
        ],
      }
    : FILTRES[filtre].where;

  const [agents, total, compteurs] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { displayName: "asc" },
      take: PLAFOND,
      include: {
        _count: {
          select: {
            inscriptions: { where: { statut: "VALIDEE" } },
            presences: { where: { etat: "PRESENT" } },
          },
        },
      },
    }),
    prisma.user.count({ where }),
    Promise.all(
      (Object.keys(FILTRES) as Filtre[]).map((cle) =>
        prisma.user.count({ where: FILTRES[cle].where }),
      ),
    ),
  ]);

  return (
    <>
      <PageHeader
        title="Annuaire des agents"
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

      {/* Onglets masqués pendant une recherche : celle-ci porte volontairement
          sur tous les comptes, et les laisser laisserait croire qu'ils la
          restreignent. */}
      {terme.length < 2 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {(Object.keys(FILTRES) as Filtre[]).map((cle, i) => (
            <Link
              key={cle}
              href={cle === "actifs" ? "/agents" : `/agents?f=${cle}`}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                filtre === cle
                  ? "bg-brand-600 text-white"
                  : "bg-slate-50 text-slate-600 hover:bg-slate-100"
              }`}
            >
              {FILTRES[cle].label}
              <span
                className={`ml-1.5 tabular-nums ${filtre === cle ? "text-brand-100" : "text-slate-400"}`}
              >
                {compteurs[i]}
              </span>
            </Link>
          ))}
        </div>
      )}

      {agents.length === 0 ? (
        <EmptyState
          title={
            terme.length >= 2
              ? `Aucun agent ne correspond à « ${terme} »`
              : "Aucun compte dans cette catégorie"
          }
          hint="Un agent n'apparaît ici qu'après sa première connexion ou une inscription faite pour lui."
        />
      ) : (
        <Card
          title={
            terme.length >= 2
              ? `${total} résultat${total > 1 ? "s" : ""}`
              : `${total} compte${total > 1 ? "s" : ""}`
          }
          action={
            total > agents.length ? (
              <span className="text-xs text-slate-400">
                {agents.length} premiers affichés — affinez par la recherche
              </span>
            ) : undefined
          }
        >
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
                      {a.anonymiseAt ? (
                        <span className="ml-2">
                          <Badge>Identité supprimée</Badge>
                        </span>
                      ) : !a.active ? (
                        <span className="ml-2">
                          <Badge>Accès fermé</Badge>
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {[mentionCompte(a.login), a.service ?? a.direction, a.email]
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
