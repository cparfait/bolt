import Link from "next/link";
import { ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { mentionCompte } from "@/lib/comptes";
import { requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  btnSecondary,
} from "@/components/ui";
import { ROLE_LABELS, pluriel } from "@/lib/constants";
import { JOUR_LABELS } from "@/lib/dates";
import { Pagination, tranche } from "@/components/pagination";

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

/**
 * Comptes par page. La liste remplaçait auparavant les suivants par « les 200
 * premiers affichés — affinez par la recherche » : un plafond n'est pas une
 * pagination, et l'annuaire d'une collectivité en compte douze cents. On ne
 * peut pas affiner quand on cherche justement à parcourir.
 */
const PAR_PAGE = 50;

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    f?: string;
    service?: string;
    activite?: string;
    creneau?: string;
    page?: string;
  }>;
}) {
  await requireUser("GESTIONNAIRE");
  const { q, f, service, activite, creneau, page: pageBrute } = await searchParams;
  const terme = (q ?? "").trim();
  const filtre: Filtre = f && f in FILTRES ? (f as Filtre) : "actifs";
  // Filtre par service : « __aucun » désigne les comptes sans rattachement,
  // ceux qu'il faut précisément aller voir pour compléter la répartition.
  const parService = (service ?? "").trim();
  const saison = await saisonCourante();

  // La recherche porte sur TOUS les comptes, filtre compris : chercher
  // quelqu'un dont on ne sait plus s'il est encore là ne doit pas renvoyer
  // « aucun résultat » parce qu'on se trouvait sur le mauvais onglet.
  const parActivite = (activite ?? "").trim();
  const parCreneau = (creneau ?? "").trim();

  // Les critères se cumulent, un par condition : c'est ce qui permet de
  // combiner « inscrits en aquagym » et « du service Voirie » sans réécrire une
  // requête par croisement possible.
  //
  // Le statut, lui, ne s'applique pas pendant une recherche : chercher
  // quelqu'un dont on ne sait plus s'il est encore là ne doit pas renvoyer
  // « aucun résultat » parce qu'on se trouvait sur le mauvais onglet.
  const conditions: Prisma.UserWhereInput[] = [];
  if (terme.length >= 2) {
    conditions.push({
      OR: [
        { displayName: { contains: terme, mode: "insensitive" } },
        { login: { contains: terme, mode: "insensitive" } },
        { email: { contains: terme, mode: "insensitive" } },
        { service: { contains: terme, mode: "insensitive" } },
        { direction: { contains: terme, mode: "insensitive" } },
      ],
    });
  } else {
    conditions.push(FILTRES[filtre].where);
  }
  if (parService === "__aucun") conditions.push({ service: null });
  else if (parService) conditions.push({ service: parService });
  // Inscrit, et pas seulement candidat : une liste d'attente ne dit pas qui
  // pratique. Bornée à la saison affichée, sans quoi un ancien inscrit de la
  // saison passée remonterait dans le public d'aujourd'hui.
  if (parCreneau) {
    conditions.push({ inscriptions: { some: { statut: "VALIDEE", creneauId: parCreneau } } });
  } else if (parActivite && saison) {
    conditions.push({
      inscriptions: {
        some: { statut: "VALIDEE", creneau: { activiteId: parActivite, saisonId: saison.id } },
      },
    });
  }
  const where: Prisma.UserWhereInput = { AND: conditions };

  // Le total d'abord : il borne le numéro de page, et l'on ne demande pas une
  // tranche avant de savoir combien il y en a.
  const total = await prisma.user.count({ where });
  const { page, pages, skip, take } = tranche(pageBrute, total, PAR_PAGE);

  const [agents, compteurs, services, repartition, creneauxSaison] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { displayName: "asc" },
      skip,
      take,
      include: {
        _count: {
          select: {
            inscriptions: { where: { statut: "VALIDEE" } },
            presences: { where: { etat: "PRESENT" } },
          },
        },
      },
    }),
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
    // De quoi peupler les deux listes de la recherche avancée. Les créneaux
    // portent le nom de leur activité : « mardi 12:15 » ne désigne rien tout
    // seul quand trois activités se tiennent le même jour.
    saison
      ? prisma.creneau.findMany({
          where: { saisonId: saison.id, archiveAt: null },
          include: { activite: { select: { id: true, nom: true, couleur: true } } },
          orderBy: [{ activite: { ordre: "asc" } }, { jour: "asc" }, { heureDebut: "asc" }],
        })
      : Promise.resolve([]),
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
  // Libellés portés par des comptes sans figurer au référentiel : ils se
  // rattachent dans Paramètres → Services, mais on doit pouvoir voir qui.
  const horsReferentiel = repartition
    .filter((r) => r.service && !referentiel.has(r.service))
    .map((r) => ({ nom: r.service as string, effectif: r._count }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const sansService = effectifs.get(null) ?? 0;
  // Activités de la saison, déduites des créneaux : une activité sans créneau
  // n'a personne à filtrer, et l'afficher promettrait une liste vide.
  const activitesSaison = [
    ...new Map(creneauxSaison.map((c) => [c.activite.id, c.activite])).values(),
  ];
  // Nombre de critères avancés posés, pour le dire sur le repli du panneau :
  // sans ce compte, une liste courte se lit comme un annuaire vide.
  const criteres = [parService, parActivite, parCreneau].filter(Boolean).length;

  const lienAgents = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    return qs ? `/agents?${qs}` : "/agents";
  };
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
        {/* Un seul formulaire : la recherche et les critères avancés partent
            ensemble. Deux formulaires distincts se seraient effacés l'un
            l'autre à chaque envoi. */}
        <form className="space-y-3">
          {/* L'onglet de statut voyage caché : ouvrir la recherche avancée
              depuis « Accès fermés » ne doit pas ramener aux comptes actifs. */}
          {filtre !== "actifs" && <input type="hidden" name="f" value={filtre} />}
          <div className="flex flex-wrap gap-2">
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
          </div>

          {/* Les services s'affichaient en pastilles, une par service : un
              référentiel de collectivité en compte cent, et la liste occupait
              tout l'écran avant la première ligne de résultat. Ils rejoignent
              une recherche avancée, avec les deux critères qui manquaient — le
              public d'une activité, celui d'un créneau —, dépliée seulement
              quand on s'en sert. Ouverte d'office si un critère est posé, sans
              quoi on ne saurait pas d'où vient une liste courte. */}
          <details open={Boolean(parService || parActivite || parCreneau)} className="group">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Recherche avancée
              {criteres > 0 && (
                <span className="rounded-full bg-brand-50 px-1.5 text-[11px] font-semibold text-brand-700">
                  {criteres}
                </span>
              )}
            </summary>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Service">
                <Select name="service" defaultValue={parService}>
                  <option value="">Tous les services</option>
                  {sansService > 0 && <option value="__aucun">Sans service ({sansService})</option>}
                  {servicesPeuples.map((s) => (
                    <option key={s.id} value={s.nom}>
                      {s.nom} ({effectifs.get(s.nom) ?? 0}){s.actif ? "" : " — retiré"}
                    </option>
                  ))}
                  {horsReferentiel.length > 0 && (
                    <optgroup label="Hors référentiel — à rattacher">
                      {horsReferentiel.map((h) => (
                        <option key={h.nom} value={h.nom}>
                          {h.nom} ({h.effectif})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </Select>
              </Field>

              <Field label="Inscrits à l'activité">
                <Select name="activite" defaultValue={parActivite}>
                  <option value="">Toutes les activités</option>
                  {activitesSaison.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nom}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Inscrits au créneau">
                <Select name="creneau" defaultValue={parCreneau}>
                  <option value="">Tous les créneaux</option>
                  {creneauxSaison.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.activite.nom} — {JOUR_LABELS[c.jour]} {c.heureDebut}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="submit" className={btnSecondary}>
                Appliquer
              </button>
              {criteres > 0 && (
                <Link href={lienCategorie} className="text-xs text-slate-500 hover:text-slate-800">
                  Tout effacer
                </Link>
              )}
              {parCreneau && parActivite && (
                <span className="text-xs text-slate-400">
                  Le créneau l&apos;emporte : il désigne déjà son activité.
                </span>
              )}
            </div>
          </details>
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
                ...(parActivite ? { activite: parActivite } : {}),
                ...(parCreneau ? { creneau: parCreneau } : {}),
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
          <Pagination
            base="/agents"
            params={{ q, f, service, activite, creneau }}
            page={page}
            pages={pages}
            total={total}
            unite="compte"
          />
        </Card>
      )}
    </>
  );
}
