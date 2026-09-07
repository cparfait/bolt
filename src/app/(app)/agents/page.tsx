import Link from "next/link";
import { ChevronRight, Search, X } from "lucide-react";
import { prisma } from "@/lib/db";
import { mentionCompte } from "@/lib/comptes";
import { requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import { Badge, Card, EmptyState, Input, PageHeader, btnSecondary } from "@/components/ui";
import { ROLE_LABELS, pluriel } from "@/lib/constants";

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
  searchParams: Promise<{ q?: string; f?: string; service?: string }>;
}) {
  await requireUser("GESTIONNAIRE");
  const { q, f, service } = await searchParams;
  const terme = (q ?? "").trim();
  const filtre: Filtre = f && f in FILTRES ? (f as Filtre) : "actifs";
  // Filtre par service : « __aucun » désigne les comptes sans rattachement,
  // ceux qu'il faut précisément aller voir pour compléter la répartition.
  const parService = (service ?? "").trim();
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
    : {
        ...FILTRES[filtre].where,
        ...(parService === "__aucun"
          ? { service: null }
          : parService
            ? { service: parService }
            : {}),
      };

  const [agents, total, compteurs, services, repartition] = await Promise.all([
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
    // Le référentiel, retirés compris : un service retiré reste porté par des
    // fiches, et c'est justement là qu'on veut voir qui.
    prisma.service.findMany({ orderBy: [{ actif: "desc" }, { ordre: "asc" }, { nom: "asc" }] }),
    // Effectif par service sur la catégorie courante, pour que les compteurs
    // répondent à la même question que la liste.
    prisma.user.groupBy({ by: ["service"], where: FILTRES[filtre].where, _count: true }),
  ]);

  const effectifs = new Map(repartition.map((r) => [r.service, r._count]));
  const referentiel = new Set(services.map((s) => s.nom));
  // Seuls les services qui ont quelqu'un, les plus fournis d'abord : une
  // pastille à zéro ne mène nulle part, et le référentiel en compte cent.
  // Un service filtré mais vide dans cette catégorie reste affiché, sinon on
  // ne saurait plus d'où vient la liste vide.
  const servicesPeuples = services
    .filter((s) => (effectifs.get(s.nom) ?? 0) > 0 || parService === s.nom)
    .sort((a, b) => (effectifs.get(b.nom) ?? 0) - (effectifs.get(a.nom) ?? 0));
  const servicesVides = services.length - servicesPeuples.length;
  // Libellés portés par des comptes sans figurer au référentiel : ils se
  // rattachent dans Paramètres → Services, mais on doit pouvoir voir qui.
  const horsReferentiel = repartition
    .filter((r) => r.service && !referentiel.has(r.service))
    .map((r) => ({ nom: r.service as string, effectif: r._count }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const sansService = effectifs.get(null) ?? 0;
  const lienAgents = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    return qs ? `/agents?${qs}` : "/agents";
  };
  const lienService = (nom: string) =>
    lienAgents({ ...(filtre !== "actifs" ? { f: filtre } : {}), service: nom });
  const lienCategorie = lienAgents(filtre !== "actifs" ? { f: filtre } : {});
  const libelleService = parService === "__aucun" ? "Sans service" : parService;

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
              href={lienAgents({
                ...(cle !== "actifs" ? { f: cle } : {}),
                ...(parService ? { service: parService } : {}),
              })}
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

      {/* Répartition par service. La liste du référentiel, avec qui s'y trouve :
          c'est la question à laquelle l'annuaire ne répondait pas — on savait
          chercher une personne, pas voir un service. */}
      {terme.length < 2 && (servicesPeuples.length > 0 || horsReferentiel.length > 0 || sansService > 0) && (
        <Card
          title="Par service"
          className="mb-4"
          action={
            <Link
              href="/parametres/services"
              className="text-xs text-slate-400 hover:text-brand-600"
            >
              Gérer le référentiel
            </Link>
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {servicesPeuples.map((s) => {
              const n = effectifs.get(s.nom) ?? 0;
              const actif = parService === s.nom;
              return (
                <Link
                  key={s.id}
                  href={actif ? lienCategorie : lienService(s.nom)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
                    actif
                      ? "bg-brand-600 text-white"
                      : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                  } ${!s.actif ? "line-through decoration-slate-300" : ""}`}
                  title={!s.actif ? "Service retiré du référentiel" : undefined}
                >
                  {s.nom}
                  <span
                    className={`tabular-nums ${actif ? "text-brand-100" : "text-slate-400"}`}
                  >
                    {n}
                  </span>
                </Link>
              );
            })}
            {horsReferentiel.map((h) => {
              const actif = parService === h.nom;
              return (
                <Link
                  key={h.nom}
                  href={actif ? lienCategorie : lienService(h.nom)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
                    actif
                      ? "bg-amber-600 text-white"
                      : "bg-amber-50 text-amber-800 hover:bg-amber-100"
                  }`}
                  title="Libellé hors référentiel — à rattacher dans Paramètres → Services"
                >
                  {h.nom}
                  <span className={`tabular-nums ${actif ? "text-amber-100" : "text-amber-500"}`}>
                    {h.effectif}
                  </span>
                </Link>
              );
            })}
            {sansService > 0 && (
              <Link
                href={parService === "__aucun" ? lienCategorie : lienService("__aucun")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm italic transition ${
                  parService === "__aucun"
                    ? "bg-slate-700 text-white"
                    : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                }`}
              >
                Sans service
                <span
                  className={`tabular-nums ${parService === "__aucun" ? "text-slate-300" : "text-slate-400"}`}
                >
                  {sansService}
                </span>
              </Link>
            )}
          </div>
          {(horsReferentiel.length > 0 || servicesVides > 0) && (
            <p className="mt-3 text-xs text-slate-400">
              {horsReferentiel.length > 0 &&
                "En orange, des libellés portés par des comptes sans figurer au référentiel : ils se rattachent dans Paramètres → Services. "}
              {servicesVides > 0 &&
                `${servicesVides} ${pluriel(servicesVides, "autre service du référentiel n'a", "autres services du référentiel n'ont")} encore personne dans cette catégorie.`}
            </p>
          )}
        </Card>
      )}

      {agents.length === 0 ? (
        <EmptyState
          title={
            terme.length >= 2
              ? `Aucun agent ne correspond à « ${terme} »`
              : parService
                ? `Aucun compte ${parService === "__aucun" ? "sans service" : `dans « ${parService} »`} dans cette catégorie`
                : "Aucun compte dans cette catégorie"
          }
          hint="Un agent n'apparaît ici qu'après sa première connexion ou une inscription faite pour lui."
        />
      ) : (
        <Card
          title={
            terme.length >= 2
              ? `${total} résultat${total > 1 ? "s" : ""}`
              : parService
                ? `${libelleService} · ${total} ${pluriel(total, "compte", "comptes")}`
                : `${total} compte${total > 1 ? "s" : ""}`
          }
          action={
            parService && terme.length < 2 ? (
              <Link
                href={lienCategorie}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
              >
                <X className="h-3.5 w-3.5" /> Tous les services
              </Link>
            ) : total > agents.length ? (
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
