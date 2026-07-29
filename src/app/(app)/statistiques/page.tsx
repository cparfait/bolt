import Link from "next/link";
import {
  CalendarX2,
  Download,
  FileSpreadsheet,
  TrendingUp,
  UserX,
  Users,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import { getGeneralSettings } from "@/lib/settings";
import {
  assiduite,
  decrocheurs,
  demandeNonSatisfaite,
  ecart,
  evolutionMensuelle,
  fiabilite,
  grilleJourHeure,
  indicateurs,
  parActivite,
  parDirection,
  saisonPrecedente,
  type Indicateurs,
} from "@/lib/stats";
import { fmtDate } from "@/lib/dates";
import {
  Card,
  EmptyState,
  Jauge,
  PageHeader,
  Select,
  Stat,
  btnSecondary,
} from "@/components/ui";
import { FiltreForm } from "@/components/filtre-form";
import { GrilleCreneaux } from "@/components/grille-creneaux";
import { HistogrammeMensuel } from "@/components/graphique";
import { RelanceForm } from "@/components/relance-form";
import { StatComparee } from "@/components/stat-comparee";
import { Panneau } from "@/components/panneau";
import { pluriel } from "@/lib/constants";

/**
 * Trois lectures d'un même jeu de données, parce que trois métiers s'en
 * servent : le bilan qui circule en comité social, le pilotage hebdomadaire du
 * service des sports, et le suivi des agents. Les mélanger sur un seul écran
 * donnait une page longue où chacun ne lisait qu'un tiers.
 */
const VUES = {
  bilan: { label: "Bilan QVT" },
  pilotage: { label: "Pilotage" },
  agents: { label: "Agents" },
} as const;

type Vue = keyof typeof VUES;

export default async function StatistiquesPage({
  searchParams,
}: {
  searchParams: Promise<{ saison?: string; activite?: string; vue?: string }>;
}) {
  await requireUser("GESTIONNAIRE");
  const {
    saison: saisonParam,
    activite: activiteParam,
    vue: vueBrute,
  } = await searchParams;
  const vue: Vue = vueBrute && vueBrute in VUES ? (vueBrute as Vue) : "bilan";

  const saisons = await prisma.saison.findMany({ orderBy: { debut: "desc" } });
  const courante = await saisonCourante();
  const saison = saisonParam
    ? (saisons.find((s) => s.id === saisonParam) ?? courante)
    : courante;

  if (!saison) {
    return (
      <>
        <PageHeader title="Statistiques" />
        <EmptyState title="Aucune saison configurée" />
      </>
    );
  }

  const g = await getGeneralSettings();
  const filtre = { saisonId: saison.id, activiteId: activiteParam || undefined };

  const [ind, listeActivites, precedente] = await Promise.all([
    indicateurs(filtre),
    prisma.activite.findMany({
      where: { creneaux: { some: { saisonId: saison.id } } },
      orderBy: { nom: "asc" },
      select: { id: true, nom: true },
    }),
    saisonPrecedente(saison.id),
  ]);

  // Comparaison à périmètre égal : même filtre d'activité, saison antérieure.
  const indPrecedent: Indicateurs | null = precedente
    ? await indicateurs({ saisonId: precedente.id, activiteId: activiteParam || undefined })
    : null;

  const params = new URLSearchParams({ saison: saison.id });
  if (activiteParam) params.set("activite", activiteParam);
  const suffixe = `?${params.toString()}`;
  const lien = (v: Vue) =>
    v === "bilan" ? `/statistiques${suffixe}` : `/statistiques${suffixe}&vue=${v}`;

  return (
    <>
      <PageHeader
        title="Statistiques"
        subtitle={`Saison ${saison.nom} — ${fmtDate(saison.debut)} au ${fmtDate(saison.fin)}`}
      >
        <FiltreForm>
          {vue !== "bilan" && <input type="hidden" name="vue" value={vue} />}
          <Select name="saison" defaultValue={saison.id} className="w-auto">
            {saisons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nom}
              </option>
            ))}
          </Select>
          <Select name="activite" defaultValue={activiteParam ?? ""} className="w-auto">
            <option value="">Toutes les activités</option>
            {listeActivites.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nom}
              </option>
            ))}
          </Select>
        </FiltreForm>
        <a href={`/statistiques/export-xlsx${suffixe}`} className={btnSecondary}>
          <FileSpreadsheet className="h-4 w-4" /> Excel
        </a>
        <a href={`/statistiques/export${suffixe}`} className={btnSecondary}>
          <Download className="h-4 w-4" /> CSV
        </a>
      </PageHeader>

      <nav className="mb-6 flex flex-wrap gap-1.5">
        {(Object.keys(VUES) as Vue[]).map((v) => (
          <Link
            key={v}
            href={lien(v)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              vue === v
                ? "bg-brand-600 text-white"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            {VUES[v].label}
          </Link>
        ))}
        {precedente && (
          <span className="ml-auto self-center text-xs text-slate-400">
            Comparaison avec la saison {precedente.nom}
          </span>
        )}
      </nav>

      {vue === "bilan" && (
        <VueBilan filtre={filtre} ind={ind} indPrecedent={indPrecedent} />
      )}
      {vue === "pilotage" && <VuePilotage filtre={filtre} />}
      {vue === "agents" && <VueAgents filtre={filtre} seuil={g.absencesAvantRelance} />}
    </>
  );
}

type Filtre = { saisonId: string; activiteId?: string };

// ── Bilan QVT ──────────────────────────────────────────────────────────────

async function VueBilan({
  filtre,
  ind,
  indPrecedent,
}: {
  filtre: Filtre;
  ind: Indicateurs;
  indPrecedent: Indicateurs | null;
}) {
  const [mensuel, directions, activites, assid] = await Promise.all([
    evolutionMensuelle(filtre),
    parDirection(filtre),
    // Le filtre s'applique ici comme partout ailleurs sur la page : un tableau
    // qui listait les six activités sous un en-tête « Yoga » se lisait comme
    // une contradiction, et le classeur exporté portait la même.
    parActivite(filtre),
    assiduite(filtre),
  ]);
  const maxDirection = Math.max(...directions.map((d) => d.presents), 1);

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatComparee
          label="Agents inscrits"
          value={ind.inscrits}
          hint={`${ind.agentsUniques} ont participé`}
          ecart={ecart(ind.inscrits, indPrecedent?.inscrits ?? null)}
        />
        <StatComparee
          label="Taux de présence"
          value={ind.tauxPresence}
          suffixe="%"
          accent="text-emerald-600 bg-emerald-50"
          hint={`${ind.presents} présences · ${ind.absents} absences`}
          ecart={ecart(ind.tauxPresence, indPrecedent?.tauxPresence ?? null)}
        />
        <StatComparee
          label="Fréquentation moyenne"
          value={ind.frequentationMoyenne}
          hint="agents par séance"
          ecart={ecart(ind.frequentationMoyenne, indPrecedent?.frequentationMoyenne ?? null)}
        />
        <StatComparee
          label="Feuilles remplies"
          value={ind.tauxEmargement}
          suffixe="%"
          accent={
            ind.tauxEmargement >= 90
              ? "text-emerald-600 bg-emerald-50"
              : "text-amber-600 bg-amber-50"
          }
          hint={`${ind.seancesEmargees}/${ind.seancesPassees} séances passées`}
          ecart={ecart(ind.tauxEmargement, indPrecedent?.tauxEmargement ?? null)}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Évolution de la fréquentation">
          <HistogrammeMensuel points={mensuel} />
          <p className="mt-3 text-xs text-slate-400">
            Nombre de présences par mois. Survolez une barre pour le détail.
          </p>
        </Card>

        <Card title="Participation par direction">
          {directions.length === 0 ? (
            <p className="text-sm text-slate-400">
              Aucune donnée. Le rattachement est repris de l&apos;annuaire à la
              connexion des agents.
            </p>
          ) : (
            <ul className="space-y-3">
              {directions.map((d) => (
                <li key={d.libelle}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{d.libelle}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">
                      {d.agents} {pluriel(d.agents, "agent")}
                    </span>
                  </div>
                  <Jauge valeur={(d.presents / maxDirection) * 100} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Par activité">
          <TableauActivites activites={activites} />
        </Card>

        <Card title="Qui vient vraiment">
          <RepartitionAssiduite a={assid} />
        </Card>
      </div>
    </>
  );
}

// ── Pilotage ───────────────────────────────────────────────────────────────

async function VuePilotage({ filtre }: { filtre: Filtre }) {
  const [grille, demande, activites, fiab] = await Promise.all([
    grilleJourHeure(filtre),
    demandeNonSatisfaite(filtre),
    parActivite(filtre),
    fiabilite(filtre),
  ]);

  const totalAttente = demande.reduce((n, d) => n + d.enAttente, 0);

  return (
    <>
      <Card title="Remplissage par jour et par heure" className="mb-6">
        <GrilleCreneaux cases={grille} />
        <p className="mt-3 text-xs text-slate-400">
          Moyenne des présences rapportée aux places du créneau, sur les séances
          émargées. Les tranches sans créneau restent visibles : c&apos;est là
          qu&apos;on peut en ouvrir un.
        </p>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card
          title="Demande non satisfaite"
          action={
            totalAttente > 0 ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                {totalAttente} en attente
              </span>
            ) : null
          }
        >
          {demande.length === 0 ? (
            <p className="text-sm text-slate-400">Aucun créneau sur cette saison.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="pb-2 font-medium">Activité</th>
                    <th className="pb-2 text-right font-medium">Places</th>
                    <th className="pb-2 text-right font-medium">File</th>
                    <th className="pb-2 text-right font-medium">Refusées</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {demande.map((d) => (
                    <tr key={d.activiteId}>
                      <td className="py-2.5">
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: d.couleur }}
                          />
                          {d.nom}
                        </span>
                        {d.aArbitrer > 0 && (
                          <span className="text-xs text-amber-600">
                            {d.aArbitrer} demande{d.aArbitrer > 1 ? "s" : ""} à arbitrer
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {d.occupees}/{d.places}
                      </td>
                      <td
                        className={`py-2.5 text-right tabular-nums font-medium ${
                          d.enAttente > 0 ? "text-amber-600" : "text-slate-400"
                        }`}
                      >
                        {d.enAttente}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-slate-500">
                        {d.refusees}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-slate-400">
                Une file d&apos;attente qui ne se vide pas justifie un créneau
                supplémentaire mieux qu&apos;un taux de remplissage, qui plafonne
                à 100 % sans dire combien attendent derrière.
              </p>
            </div>
          )}
        </Card>

        <Card title="Remplissage par activité">
          {activites.length === 0 ? (
            <p className="text-sm text-slate-400">Aucune séance émargée.</p>
          ) : (
            <ul className="space-y-3.5">
              {activites.map((a) => (
                <li key={a.activiteId}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{a.nom}</span>
                    <span className="tabular-nums text-slate-500">{a.tauxRemplissage}%</span>
                  </div>
                  <Jauge valeur={a.tauxRemplissage} couleur={a.couleur} />
                  <p className="mt-1 text-xs text-slate-400">
                    {a.presents} présences pour {a.capacite} places offertes
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Fiabilité de l'offre">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Séances annulées"
            value={fiab.seancesAnnulees}
            suffixe=""
            hint={`${fiab.tauxAnnulation}% des ${fiab.seancesPrevues} séances`}
            accent={
              fiab.tauxAnnulation > 10
                ? "text-red-600 bg-red-50"
                : "text-slate-400 bg-slate-50"
            }
            icon={<CalendarX2 className="h-4 w-4" />}
          />
          <Stat
            label="Absences annoncées"
            value={fiab.partAnnoncee}
            suffixe="%"
            hint={`${fiab.absencesAnnoncees} prévenues sur ${fiab.absencesConstatees} absences`}
            accent="text-emerald-600 bg-emerald-50"
          />
          <Stat
            label="Désistements"
            value={fiab.desistements}
            hint="inscriptions abandonnées en cours de saison"
            icon={<UserX className="h-4 w-4" />}
          />
        </div>

        {fiab.motifs.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Motifs d&apos;annulation
            </p>
            <ul className="divide-y divide-slate-100 text-sm">
              {fiab.motifs.map((m) => (
                <li key={m.motif} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">{m.motif}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {m.nombre} {pluriel(m.nombre, "séance")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </>
  );
}

// ── Agents ─────────────────────────────────────────────────────────────────

async function VueAgents({ filtre, seuil }: { filtre: Filtre; seuil: number }) {
  const [assid, lachages, fiab] = await Promise.all([
    assiduite(filtre),
    decrocheurs(filtre, seuil),
    fiabilite(filtre),
  ]);

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Inscrits"
          value={assid.agents}
          icon={<Users className="h-4 w-4" />}
          hint={`${assid.agents - assid.jamaisVenus} sont venus au moins une fois`}
        />
        <Stat
          label="Taux d'assiduité"
          value={assid.tauxAssiduite}
          suffixe="%"
          accent="text-emerald-600 bg-emerald-50"
          hint="présences / séances proposées aux inscrits"
        />
        <Stat
          label="Séances par agent"
          value={assid.seancesMoyennes}
          hint="moyenne, parmi ceux qui sont venus"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <Stat
          label="Jamais venus"
          value={assid.jamaisVenus}
          accent={
            assid.jamaisVenus > 0 ? "text-red-600 bg-red-50" : "text-slate-400 bg-slate-50"
          }
          hint="inscrits sans aucune présence"
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Régularité des inscrits">
          <RepartitionAssiduite a={assid} />
        </Card>

        <Card title="Prévenir ou pas">
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">Absences annoncées à l&apos;avance</span>
                <span className="tabular-nums text-slate-500">{fiab.partAnnoncee}%</span>
              </div>
              <Jauge valeur={fiab.partAnnoncee} couleur="#059669" />
              <p className="mt-1 text-xs text-slate-400">
                {fiab.absencesAnnoncees} absences prévenues sur {fiab.absencesConstatees}{" "}
                constatées.
              </p>
            </div>
            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
              Une absence annoncée permet à l&apos;animateur de ne pas attendre, et
              distingue l&apos;empêchement ponctuel de l&apos;abandon. C&apos;est le
              rappel de la veille qui fait monter ce taux — il s&apos;active dans
              Paramètres → Messagerie.
            </p>
          </div>
        </Card>
      </div>

      <section id="decrocheurs" className="scroll-mt-6">
        <Card
          title={`Agents qui ne viennent plus (${lachages.length})`}
          action={
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <UserX className="h-3.5 w-3.5" />
              {seuil} absences consécutives
            </span>
          }
        >
          {lachages.length === 0 ? (
            <p className="text-sm text-slate-400">
              Personne n&apos;a décroché : la fréquentation est stable.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="pb-2 font-medium">Agent</th>
                      <th className="pb-2 font-medium">Activité</th>
                      <th className="pb-2 text-right font-medium">Absences</th>
                      <th className="pb-2 text-right font-medium">Dernière venue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lachages.map((d) => (
                      <tr key={`${d.userId}-${d.creneauId}`}>
                        <td className="py-2.5 font-medium">
                          <Link
                            href={`/agents/${d.userId}`}
                            className="hover:text-brand-600"
                          >
                            {d.nom}
                          </Link>
                        </td>
                        <td className="py-2.5 text-slate-500">{d.activite}</td>
                        <td className="py-2.5 text-right tabular-nums text-amber-600">
                          {d.absencesConsecutives}
                        </td>
                        <td className="py-2.5 text-right text-slate-500">
                          {d.derniereVenue ? fmtDate(d.derniereVenue) : "jamais"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4">
                <Panneau
                  titre="Relancer par e-mail"
                  sousTitre="Les libérer de leur place, ou les faire revenir"
                >
                  <RelanceForm decrocheurs={lachages} />
                </Panneau>
              </div>
            </>
          )}
        </Card>
      </section>
    </>
  );
}

// ── Fragments partagés ─────────────────────────────────────────────────────

function TableauActivites({
  activites,
}: {
  activites: Awaited<ReturnType<typeof parActivite>>;
}) {
  if (activites.length === 0) {
    return <p className="text-sm text-slate-400">Aucune séance émargée.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="pb-2 font-medium">Activité</th>
            <th className="pb-2 text-right font-medium">Inscrits</th>
            <th className="pb-2 text-right font-medium">Moy./séance</th>
            <th className="pb-2 text-right font-medium">Présence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {activites.map((a) => (
            <tr key={a.activiteId}>
              <td className="py-2.5">
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: a.couleur }}
                  />
                  {a.nom}
                </span>
                <span className="text-xs text-slate-400">
                  {a.seancesEmargees}{" "}
                  {pluriel(a.seancesEmargees, "séance émargée", "séances émargées")}
                </span>
              </td>
              <td className="py-2.5 text-right tabular-nums">{a.inscrits}</td>
              <td className="py-2.5 text-right font-medium tabular-nums">{a.moyenne}</td>
              <td className="py-2.5 text-right tabular-nums">{a.tauxPresence}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Répartition des inscrits par régularité.
 *
 * Un taux de présence moyen recouvre deux populations opposées — ceux qui
 * viennent toujours et ceux qui ne viennent jamais donnent la même moyenne
 * qu'un groupe venant une fois sur deux. L'action à mener, elle, diffère.
 */
function RepartitionAssiduite({
  a,
}: {
  a: Awaited<ReturnType<typeof assiduite>>;
}) {
  const groupes = [
    { libelle: "Assidus", detail: "80 % et plus", n: a.assidus, couleur: "#059669" },
    { libelle: "Réguliers", detail: "40 à 80 %", n: a.reguliers, couleur: "#4f46e5" },
    { libelle: "Occasionnels", detail: "moins de 40 %", n: a.occasionnels, couleur: "#d97706" },
    { libelle: "Jamais venus", detail: "aucune présence", n: a.jamaisVenus, couleur: "#dc2626" },
  ];
  if (a.agents === 0) {
    return <p className="text-sm text-slate-400">Aucun inscrit sur ce périmètre.</p>;
  }

  return (
    <>
      {/* Barre empilée : la proportion se lit avant les nombres. */}
      <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-slate-100">
        {groupes.map((g) =>
          g.n === 0 ? null : (
            <span
              key={g.libelle}
              title={`${g.libelle} — ${g.n}`}
              style={{ width: `${(g.n / a.agents) * 100}%`, backgroundColor: g.couleur }}
            />
          ),
        )}
      </div>
      <ul className="space-y-2 text-sm">
        {groupes.map((g) => (
          <li key={g.libelle} className="flex items-baseline justify-between gap-3">
            <span className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: g.couleur }}
              />
              {g.libelle}
              <span className="text-xs text-slate-400">{g.detail}</span>
            </span>
            <span className="shrink-0 tabular-nums text-slate-500">
              {g.n} <span className="text-xs text-slate-400">
                ({Math.round((g.n / a.agents) * 100)}%)
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-400">
        Part des séances suivies parmi celles proposées sur ses créneaux, séances
        annulées et feuilles manquantes exclues.
      </p>
    </>
  );
}
