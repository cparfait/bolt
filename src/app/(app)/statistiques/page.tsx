import Link from "next/link";
import {
  CalendarX2,
  Download,
  FileSpreadsheet,
  TrendingUp,
  Undo2,
  UserX,
  Users,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import { getGeneralSettings } from "@/lib/settings";
import {
  assiduite,
  chargerSeances,
  decrocheurs,
  demandeNonSatisfaite,
  ecart,
  evolutionMensuelle,
  fiabilite,
  grilleJourHeure,
  indicateurs,
  parActivite,
  parDirection,
  parService,
  repartirEnParts,
  saisonPrecedente,
  type Indicateurs,
  type SeanceChargee,
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

  // La saison est chargée une fois et passée à chaque indicateur : chaque vue
  // en appelait cinq ou six, qui relisaient chacun les mêmes séances.
  const seances = await chargerSeances(filtre);
  const [ind, listeActivites, precedente] = await Promise.all([
    indicateurs(filtre, seances),
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
      <p className="-mt-3 mb-5 text-xs text-slate-500">
        Pour lecture, préférez le classeur Excel ; le CSV est destiné au
        retraitement.
      </p>

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
          <span className="ml-auto self-center text-xs text-slate-500">
            Comparaison avec la saison {precedente.nom}
          </span>
        )}
      </nav>

      {vue === "bilan" && (
        <VueBilan
          filtre={filtre}
          seances={seances}
          ind={ind}
          indPrecedent={indPrecedent}
          vers={versDetail(filtre, "bilan")}
        />
      )}
      {vue === "pilotage" && (
        <VuePilotage filtre={filtre} seances={seances} vers={versDetail(filtre, "pilotage")} />
      )}
      {vue === "agents" && (
        <VueAgents
          filtre={filtre}
          seances={seances}
          seuil={g.absencesAvantRelance}
          vers={versDetail(filtre, "agents")}
        />
      )}
    </>
  );
}

type Filtre = { saisonId: string; activiteId?: string };

/**
 * Où mène un chiffre.
 *
 * Chaque ligne de ces écrans est un total, et un total ne dit pas quoi faire :
 * « 3 jamais venus » appelle une relance, encore faut-il savoir lesquels. Le
 * lien porte le filtre courant et la vue d'où l'on part, pour que le retour
 * ramène exactement où l'on était.
 */
type Vers = (type: string, valeur: string) => string;

function versDetail(filtre: Filtre, vue: Vue): Vers {
  return (type, valeur) => {
    const p = new URLSearchParams({ saison: filtre.saisonId, type, valeur });
    if (filtre.activiteId) p.set("activite", filtre.activiteId);
    if (vue !== "bilan") p.set("vue", vue);
    return `/statistiques/detail?${p.toString()}`;
  };
}

/** Rend une ligne de tableau cliquable sans la déguiser en bouton. */
const LIGNE_CLIQUABLE = "cursor-pointer transition hover:bg-slate-50";

// ── Bilan QVT ──────────────────────────────────────────────────────────────

async function VueBilan({
  filtre,
  seances,
  ind,
  indPrecedent,
  vers,
}: {
  filtre: Filtre;
  seances: SeanceChargee[];
  ind: Indicateurs;
  indPrecedent: Indicateurs | null;
  vers: Vers;
}) {
  const [mensuel, directions, services, activites, assid] = await Promise.all([
    evolutionMensuelle(filtre, seances),
    parDirection(filtre, seances),
    parService(filtre),
    // Le filtre s'applique ici comme partout ailleurs sur la page : un tableau
    // qui listait les six activités sous un en-tête « Yoga » se lisait comme
    // une contradiction, et le classeur exporté portait la même.
    parActivite(filtre, seances),
    assiduite(filtre, seances),
  ]);
  const maxDirection = Math.max(...directions.map((d) => d.presents), 1);

  return (
    <>
      {/* Trois indicateurs, et non quatre : « Feuilles remplies » mesurait le
          travail d'émargement des animateurs, pas la qualité de vie au
          travail. Sa place n'était pas en tête d'un bilan QVT, où il se lisait
          comme une contre-performance des agents. L'information reste dans le
          classeur exporté, avec sa définition en regard. */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        {/* « à ce jour » : le compteur lit les inscriptions validées au moment
            où l'on regarde, pas celles de toute la saison — un désisté de
            janvier n'y figure plus en juin. */}
        <StatComparee
          label="Agents inscrits à ce jour"
          value={ind.inscrits}
          hint={`${ind.agentsUniques} ont participé`}
          ecart={ecart(ind.inscrits, indPrecedent?.inscrits ?? null)}
        />
        <StatComparee
          label="Taux de présence"
          value={ind.tauxPresence}
          suffixe="%"
          accent="text-emerald-600 bg-emerald-50"
          hint={`${ind.presents} présents sur ${ind.presents + ind.absents} attendus`}
          ecart={ecart(ind.tauxPresence, indPrecedent?.tauxPresence ?? null)}
        />
        <StatComparee
          label="Fréquentation moyenne"
          value={ind.frequentationMoyenne}
          hint="agents par séance"
          ecart={ecart(ind.frequentationMoyenne, indPrecedent?.frequentationMoyenne ?? null)}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Évolution de la fréquentation">
          <HistogrammeMensuel points={mensuel} lien={(p) => vers("mois", p.cle)} />
          <p className="mt-3 text-xs text-slate-500">
            Nombre de présences par mois. Survolez une barre pour le résumé,
            cliquez pour les séances du mois.
          </p>
        </Card>

        <Card title="Participation par direction">
          {directions.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aucune donnée. Le rattachement est repris de l&apos;annuaire à la
              connexion des agents.
            </p>
          ) : (
            <ul className="space-y-3">
              {directions.map((d) => (
                <li key={d.libelle}>
                  <Link
                    href={vers("direction", d.libelle)}
                    className="block rounded-lg p-1 transition hover:bg-slate-50"
                  >
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{d.libelle}</span>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        {d.agents} {pluriel(d.agents, "agent")}
                      </span>
                    </div>
                    <Jauge valeur={(d.presents / maxDirection) * 100} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Les deux pourcentages que le comité social demande : « quelle part des
          agents de tel service s'est inscrite ? » et « qui pèse quoi dans le
          total ? ». Le premier seul désigne les services où la démarche n'est
          pas arrivée ; le second seul les confondrait avec les petits. */}
      <Card title="Inscriptions par service" className="mb-6">
        {services.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucun inscrit sur ce périmètre.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3 font-medium">Service</th>
                    <th className="py-2 pr-3 text-right font-medium">Inscrits</th>
                    <th className="py-2 pr-3 text-right font-medium">Effectif</th>
                    <th className="py-2 pr-3 text-right font-medium">% inscrits</th>
                    <th className="w-40 py-2 pr-3 font-medium">Couverture</th>
                    <th className="py-2 text-right font-medium">Part du total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {services.map((s) => (
                    <tr key={s.libelle} className={LIGNE_CLIQUABLE}>
                      <td className="py-2 pr-3">
                        <Link
                          href={vers("service", s.libelle)}
                          className="block font-medium hover:text-brand-600"
                        >
                          {s.libelle}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{s.inscrits}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-500">
                        {s.effectif ?? "—"}
                      </td>
                      <td className="py-2 pr-3 text-right font-medium tabular-nums">
                        {s.couverture === null ? "—" : `${s.couverture} %`}
                        {/* Au-delà de 100 %, le chiffre est gardé : il compte
                            des inscrits que l'annuaire ne rattache pas au
                            service, et le taire cacherait l'écart. */}
                        {s.couverture !== null && s.couverture > 100 && (
                          <span className="block text-xs font-normal text-slate-500">
                            inscrits hors annuaire compris
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {s.couverture === null ? (
                          <span className="text-xs text-slate-500">effectif inconnu</span>
                        ) : (
                          <Jauge valeur={Math.min(100, s.couverture)} />
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums text-slate-500">
                        {s.part} %
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              « % inscrits » rapporte les agents inscrits à l&apos;effectif du
              service dans l&apos;annuaire (comptes actifs, après regroupement des
              libellés) ; « part du total » dit ce que le service pèse parmi
              tous les inscrits. Un effectif inconnu signale un service auquel
              aucun compte actif de l&apos;annuaire ne se rattache — participants
              hors annuaire, ou rattachement saisi à la main. Au-delà de 100 %,
              des inscrits que l&apos;annuaire ne rattache pas à ce service y
              sont comptés.
            </p>
          </>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Par activité">
          <TableauActivites activites={activites} vers={vers} />
        </Card>

        <Card title="Qui vient vraiment">
          <RepartitionAssiduite a={assid} vers={vers} />
        </Card>
      </div>
    </>
  );
}

// ── Pilotage ───────────────────────────────────────────────────────────────

async function VuePilotage({
  filtre,
  seances,
  vers,
}: {
  filtre: Filtre;
  seances: SeanceChargee[];
  vers: Vers;
}) {
  const [grille, demande, activites, fiab] = await Promise.all([
    grilleJourHeure(filtre, seances),
    demandeNonSatisfaite(filtre),
    parActivite(filtre, seances),
    fiabilite(filtre, seances),
  ]);

  const totalAttente = demande.reduce((n, d) => n + d.enAttente, 0);

  return (
    <>
      <Card title="Remplissage par jour et par heure" className="mb-6">
        <GrilleCreneaux cases={grille} lien={(c) => vers("creneau", `${c.jour}-${c.heure}`)} />
        <p className="mt-3 text-xs text-slate-500">
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
            <p className="text-sm text-slate-500">Aucun créneau sur cette saison.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="pb-2 font-medium">Activité</th>
                    <th className="pb-2 text-right font-medium">Places</th>
                    <th className="pb-2 text-right font-medium">File</th>
                    <th className="pb-2 text-right font-medium">Refusées</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {demande.map((d) => (
                    <tr
                      key={d.activiteId}
                      className={LIGNE_CLIQUABLE}
                    >
                      <td className="relative py-2.5">
                        <Link
                          href={vers("attente", d.activiteId)}
                          className="absolute inset-0"
                          aria-label={`Détail des demandes — ${d.nom}`}
                        />
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
                          d.enAttente > 0 ? "text-amber-600" : "text-slate-500"
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
              <p className="mt-3 text-xs text-slate-500">
                Une file d&apos;attente qui ne se vide pas justifie un créneau
                supplémentaire mieux qu&apos;un taux de remplissage, qui plafonne
                à 100 % sans dire combien attendent derrière.
              </p>
            </div>
          )}
        </Card>

        <Card title="Remplissage par activité">
          {activites.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune séance émargée.</p>
          ) : (
            <ul className="space-y-3.5">
              {activites.map((a) => (
                <li key={a.activiteId}>
                  <Link
                    href={vers("activite", a.activiteId)}
                    className="block rounded-lg p-1 transition hover:bg-slate-50"
                  >
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium">{a.nom}</span>
                      <span className="tabular-nums text-slate-500">{a.tauxRemplissage}%</span>
                    </div>
                    <Jauge valeur={a.tauxRemplissage} couleur={a.couleur} />
                    <p className="mt-1 text-xs text-slate-500">
                      {a.presents} présences pour {a.capacite} places offertes
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Fiabilité de l'offre">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Séances annulées"
            value={fiab.seancesAnnulees}
            suffixe=""
            hint={`${fiab.tauxAnnulation}% des ${fiab.seancesPrevues} séances passées ou annulées`}
            accent={
              fiab.tauxAnnulation > 10
                ? "text-red-600 bg-red-50"
                : "text-slate-500 bg-slate-50"
            }
            icon={<CalendarX2 className="h-4 w-4" />}
          />
          <Stat
            label="Absences annoncées"
            value={fiab.partAnnoncee}
            suffixe="%"
            hint={`${fiab.absencesAnnoncees} prévenues sur ${fiab.absencesConstatees} absences pointées`}
            accent="text-emerald-600 bg-emerald-50"
          />
          <Stat
            label="Désistements"
            value={fiab.desistements}
            hint="inscriptions abandonnées en cours de saison"
            icon={<UserX className="h-4 w-4" />}
          />
          {/* Une place rendue aussitôt reçue ne dit rien de la personne : elle
              dit qu'on a attendu trop longtemps pour l'obtenir. Le chiffre
              n'existe que si la file a tourné — d'où la tuile muette tant
              qu'aucune promotion n'a eu lieu, plutôt qu'un 0 % trompeur. */}
          <Stat
            label="Places rendues"
            value={fiab.promotionsRendues}
            hint={
              fiab.promotions > 0
                ? `sur ${fiab.promotions} ${pluriel(fiab.promotions, "place")} ${
                    fiab.promotions > 1 ? "attribuées" : "attribuée"
                  } depuis la file — ${fiab.tauxPromotionRendue} %`
                : "aucune place n'a encore été attribuée depuis la liste d'attente"
            }
            accent={
              fiab.tauxPromotionRendue > 30
                ? "text-amber-600 bg-amber-50"
                : "text-slate-500 bg-slate-50"
            }
            icon={<Undo2 className="h-4 w-4" />}
            href={fiab.promotionsRendues > 0 ? vers("promotion", "rendues") : undefined}
          />
        </div>

        {fiab.motifs.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Motifs d&apos;annulation
            </p>
            <ul className="divide-y divide-slate-100 text-sm">
              {fiab.motifs.map((m) => (
                <li key={m.motif}>
                  <Link
                    href={vers("motif", m.motif)}
                    className="flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition hover:bg-slate-50"
                  >
                    <span className="min-w-0 truncate">{m.motif}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">
                      {m.nombre} {pluriel(m.nombre, "séance")}
                    </span>
                  </Link>
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

async function VueAgents({
  filtre,
  seances,
  seuil,
  vers,
}: {
  filtre: Filtre;
  seances: SeanceChargee[];
  seuil: number;
  vers: Vers;
}) {
  const [assid, lachages, fiab] = await Promise.all([
    assiduite(filtre, seances),
    decrocheurs(filtre, seuil),
    fiabilite(filtre, seances),
  ]);

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* `venus` et non « inscrits − jamais venus » : ceux dont aucune
            séance n'a encore été émargée ne sont ni l'un ni l'autre. */}
        <Stat
          label="Inscrits à ce jour"
          value={assid.agents}
          icon={<Users className="h-4 w-4" />}
          hint={`${assid.venus} ${assid.venus > 1 ? "sont venus" : "est venu"} au moins une fois`}
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
            assid.jamaisVenus > 0 ? "text-red-600 bg-red-50" : "text-slate-500 bg-slate-50"
          }
          hint="inscrits sans aucune présence"
          href={assid.jamaisVenus > 0 ? vers("assiduite", "jamais") : undefined}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Régularité des inscrits">
          <RepartitionAssiduite a={assid} vers={vers} />
        </Card>

        <Card title="Prévenir ou pas">
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">Absences annoncées à l&apos;avance</span>
                <span className="tabular-nums text-slate-500">{fiab.partAnnoncee}%</span>
              </div>
              <Jauge valeur={fiab.partAnnoncee} couleur="#059669" />
              <p className="mt-1 text-xs text-slate-500">
                {fiab.absencesAnnoncees} absences prévenues sur {fiab.absencesConstatees}{" "}
                pointées sur les feuilles.
              </p>
            </div>
            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
              Une absence annoncée permet à l&apos;animateur de ne pas attendre, et
              distingue l&apos;empêchement ponctuel de l&apos;abandon. C&apos;est le
              rappel de la veille qui fait monter ce taux — il s&apos;active dans
              Paramètres → Général.
            </p>
          </div>
        </Card>
      </div>

      <section id="decrocheurs" className="scroll-mt-6">
        <Card
          title={`Agents qui ne viennent plus (${lachages.length})`}
          action={
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <UserX className="h-3.5 w-3.5" />
              {seuil} absences consécutives
            </span>
          }
        >
          {lachages.length === 0 ? (
            <p className="text-sm text-slate-500">
              Personne n&apos;a décroché : la fréquentation est stable.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
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
  vers,
}: {
  activites: Awaited<ReturnType<typeof parActivite>>;
  vers: Vers;
}) {
  if (activites.length === 0) {
    return <p className="text-sm text-slate-500">Aucune séance émargée.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="pb-2 font-medium">Activité</th>
            <th className="pb-2 text-right font-medium">Inscrits</th>
            <th className="pb-2 text-right font-medium">Moy./séance</th>
            <th className="pb-2 text-right font-medium" title="présents / attendus">
              Présence
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {activites.map((a) => (
            <tr key={a.activiteId} className={LIGNE_CLIQUABLE}>
              <td className="relative py-2.5">
                <Link
                  href={vers("activite", a.activiteId)}
                  className="absolute inset-0"
                  aria-label={`Détail — ${a.nom}`}
                />
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: a.couleur }}
                  />
                  {a.nom}
                </span>
                <span className="text-xs text-slate-500">
                  {a.suiviPresence ? (
                    <>
                      {a.seancesEmargees}{" "}
                      {pluriel(a.seancesEmargees, "séance émargée", "séances émargées")}
                    </>
                  ) : (
                    "pratique en autonomie, sans émargement"
                  )}
                </span>
              </td>
              <td className="py-2.5 text-right tabular-nums">{a.inscrits}</td>
              {/* Un tiret, pas un zéro : une activité qu'on ne pointe pas n'a
                  pas une fréquentation nulle, elle a une fréquentation
                  inconnue. Afficher 0 % la ferait passer pour la moins suivie
                  alors qu'elle est parfois la plus courue. */}
              <td className="py-2.5 text-right font-medium tabular-nums">
                {a.suiviPresence ? a.moyenne : <span className="text-slate-300">—</span>}
              </td>
              <td className="py-2.5 text-right tabular-nums">
                {a.suiviPresence ? (
                  `${a.tauxPresence}%`
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-slate-500">
        Présence : présents rapportés aux attendus — inscrits du jour et
        ponctuels pointés —, sur les séances émargées.
      </p>
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
  vers,
}: {
  a: Awaited<ReturnType<typeof assiduite>>;
  vers: Vers;
}) {
  const groupes = [
    { cle: "assidus", libelle: "Assidus", detail: "80 % et plus", n: a.assidus, couleur: "#059669" },
    { cle: "reguliers", libelle: "Réguliers", detail: "40 à 80 %", n: a.reguliers, couleur: "#4f46e5" },
    { cle: "occasionnels", libelle: "Occasionnels", detail: "moins de 40 %", n: a.occasionnels, couleur: "#d97706" },
    { cle: "jamais", libelle: "Jamais venus", detail: "aucune présence", n: a.jamaisVenus, couleur: "#dc2626" },
  ];
  if (a.agents === 0) {
    return <p className="text-sm text-slate-500">Aucun inscrit sur ce périmètre.</p>;
  }
  // Parts qui somment à 100 : arrondies une à une, elles affichaient 99 ou 101.
  const parts = repartirEnParts(groupes.map((g) => g.n));

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
      <ul className="space-y-1 text-sm">
        {groupes.map((g, idx) => {
          const ligne = (
            <>
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: g.couleur }}
                />
                {g.libelle}
                <span className="text-xs text-slate-500">{g.detail}</span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {g.n} <span className="text-xs text-slate-500">
                  ({parts[idx]}%)
                </span>
              </span>
            </>
          );
          const classe = "flex items-baseline justify-between gap-3 rounded-lg px-1 py-1";
          // Un groupe vide ne mène nulle part : la page de détail serait vide,
          // et une ligne qui réagit au survol promet quelque chose à voir.
          return (
            <li key={g.cle}>
              {g.n > 0 ? (
                <Link
                  href={vers("assiduite", g.cle)}
                  className={`${classe} transition hover:bg-slate-50`}
                >
                  {ligne}
                </Link>
              ) : (
                <span className={`${classe} text-slate-500`}>{ligne}</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Part des séances suivies parmi celles proposées sur ses créneaux, séances
        annulées et feuilles manquantes exclues.
      </p>
    </>
  );
}
