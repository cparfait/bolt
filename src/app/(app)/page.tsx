import Link from "next/link";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  Hourglass,
  TrendingUp,
  UserX,
  Users,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { estGestionnaire, requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import { getGeneralSettings } from "@/lib/settings";
import { decrocheurs, indicateurs, parActivite } from "@/lib/stats";
import { JOURS_FEUILLES_MANQUANTES, feuillesAttendues } from "@/lib/emargement";
import { prochainesSeancesDe } from "@/lib/actions/absences";
import { MesSeances } from "@/components/mes-seances";
import { RechercheRapide } from "@/components/recherche-rapide";
import {
  ajouterJours,
  aujourdhui,
  debutMois,
  debutSemaine,
  finMois,
  finSemaine,
  fmtDate,
  fmtDateLongue,
  fmtJourCourt,
} from "@/lib/dates";
import {
  Alerte,
  Badge,
  Card,
  EmptyState,
  Jauge,
  PageHeader,
  Stat,
  btnPrimary,
  btnSecondary,
} from "@/components/ui";
import { JOUR_LABELS } from "@/lib/dates";
import { SEANCE_STATUT_COLORS, SEANCE_STATUT_LABELS, pluriel, prenomDe } from "@/lib/constants";

/** Périodes proposées sur le tableau de bord du service des sports. */
const VUES = {
  jour: { label: "Aujourd'hui" },
  semaine: { label: "Cette semaine" },
  mois: { label: "Ce mois-ci" },
} as const;

type Vue = keyof typeof VUES;

function bornes(vue: Vue): { debut: Date; fin: Date } {
  const today = aujourdhui();
  if (vue === "jour") return { debut: today, fin: today };
  if (vue === "semaine") return { debut: debutSemaine(today), fin: finSemaine(today) };
  return { debut: debutMois(today), fin: finMois(today) };
}

export default async function TableauDeBord({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string }>;
}) {
  const user = await requireUser();


  const { vue: vueBrute } = await searchParams;
  const vue: Vue = vueBrute && vueBrute in VUES ? (vueBrute as Vue) : "jour";
  const saison = await saisonCourante();
  const g = await getGeneralSettings();

  if (!saison) {
    return (
      <>
        <PageHeader title={`Bienvenue dans ${g.appName}`} subtitle={g.appDescription} />
        <EmptyState
          title="Aucune saison n'est encore créée"
          hint="Commencez par créer la saison, puis les activités et leurs créneaux."
        />
        {estGestionnaire(user) && (
          <div className="mt-4 flex gap-2">
            <Link href="/parametres/saisons" className={btnPrimary}>
              Créer la saison
            </Link>
          </div>
        )}
      </>
    );
  }

  // ── Vue agent ────────────────────────────────────────────────────────────
  if (!estGestionnaire(user) && user.role !== "COACH") {
    const [inscriptions, prochaines] = await Promise.all([
      prisma.inscription.findMany({
        where: { userId: user.id, statut: { in: ["VALIDEE", "EN_ATTENTE", "LISTE_ATTENTE"] } },
        include: { creneau: { include: { activite: true } } },
      }),
      prochainesSeancesDe(user.id, 6),
    ]);

    const mesPresences = await prisma.presence.count({
      where: { userId: user.id, etat: "PRESENT" },
    });

    return (
      <>
        <PageHeader
          title={`Bonjour ${prenomDe(user.displayName)}`}
          subtitle={`Saison ${saison.nom}`}
        >
          <Link href="/mes-activites" className={btnPrimary}>
            Voir le catalogue
          </Link>
        </PageHeader>

        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Stat
            label="Activités suivies"
            value={inscriptions.filter((i) => i.statut === "VALIDEE").length}
            icon={<Users className="h-4 w-4" />}
            href="/mes-activites"
          />
          <Stat
            label="Séances suivies"
            value={mesPresences}
            icon={<CalendarCheck className="h-4 w-4" />}
            accent="text-emerald-600 bg-emerald-50"
            href="/mes-activites"
          />
          <Stat
            label="En attente"
            value={inscriptions.filter((i) => i.statut !== "VALIDEE").length}
            icon={<ClipboardCheck className="h-4 w-4" />}
            accent="text-amber-600 bg-amber-50"
            href="/mes-activites"
          />
        </div>

        {/* Une colonne, pas deux : un agent suit une ou deux activités, la
            carte des inscriptions restait presque vide à côté d'un agenda
            étiré en hauteur. Les inscriptions tiennent donc sur une ligne de
            tuiles, et l'agenda occupe toute la largeur. */}
        <div className="space-y-6">
          {inscriptions.length === 0 ? (
            <Card title="Mes inscriptions">
              <EmptyState
                title="Vous n'êtes inscrit à aucune activité"
                hint="Parcourez le catalogue pour choisir un créneau."
              />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {inscriptions.map((i) => (
                <div
                  key={i.id}
                  className="rounded-2xl border border-slate-200 border-l-4 bg-white p-4 shadow-sm"
                  style={{ borderLeftColor: i.creneau.activite.couleur }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold leading-tight">
                      {i.creneau.activite.nom}
                    </p>
                    <Badge>
                      {i.statut === "VALIDEE"
                        ? "Inscrit"
                        : i.statut === "LISTE_ATTENTE"
                          ? `Attente n°${i.rang}`
                          : "À valider"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {JOUR_LABELS[i.creneau.jour]} {i.creneau.heureDebut}–
                    {i.creneau.heureFin}
                    {i.creneau.lieu ? ` · ${i.creneau.lieu}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}

          <MesSeances seances={prochaines} />
        </div>
      </>
    );
  }

  // ── Vue animateur (compte AD ou local) ───────────────────────────────────
  if (user.role === "COACH") {
    const coach = await prisma.coach.findUnique({ where: { userId: user.id } });
    const seances = coach
      ? await prisma.seance.findMany({
          where: {
            creneau: { animateurs: { some: { id: coach.id } } },
            date: { gte: ajouterJours(aujourdhui(), -7), lte: ajouterJours(aujourdhui(), 7) },
          },
          include: { creneau: { include: { activite: true } }, _count: { select: { presences: true } } },
          orderBy: [{ date: "asc" }, { creneau: { heureDebut: "asc" } }],
        })
      : [];

    return (
      <>
        <PageHeader
          title={`Bonjour ${prenomDe(user.displayName)}`}
          subtitle="Vos séances de la semaine"
        />
        <Card title="Séances">
          {seances.length === 0 ? (
            <EmptyState title="Aucune séance sur la période" />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {seances.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <Link href={`/seances/${s.id}`} className="font-medium hover:text-brand-600">
                      {s.creneau.activite.nom}
                    </Link>
                    <p className="text-xs text-slate-400">
                      {fmtDateLongue(s.date)} · {s.creneau.heureDebut}–{s.creneau.heureFin}
                    </p>
                  </div>
                  <Badge color={SEANCE_STATUT_COLORS[s.statut]}>
                    {s.statut === "FAITE"
                      ? `${s._count.presences} ${pluriel(s._count.presences, "pointé")}`
                      : SEANCE_STATUT_LABELS[s.statut]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </>
    );
  }


  const filtre = { saisonId: saison.id };
  const periode = bornes(vue);
  const compteur = (v: Vue) => {
    const b = bornes(v);
    return prisma.seance.count({
      where: { date: { gte: b.debut, lte: b.fin }, creneau: { saisonId: saison.id } },
    });
  };

  const [
    ind,
    activites,
    aValider,
    enListeAttente,
    seancesPeriode,
    seancesSansEmargement,
    lachages,
    nbJour,
    nbSemaine,
    nbMois,
  ] = await Promise.all([
    indicateurs(filtre),
    parActivite(filtre),
    prisma.inscription.count({ where: { statut: "EN_ATTENTE", creneau: { saisonId: saison.id } } }),
    // La liste d'attente compte aussi : personne ne la promeut si le créneau
    // reste plein toute la saison, c'est au service d'ouvrir une place ou de
    // prévenir l'agent. Sans ce chiffre, elle dormait sur la page Inscriptions.
    prisma.inscription.count({
      where: { statut: "LISTE_ATTENTE", creneau: { saisonId: saison.id } },
    }),
    prisma.seance.findMany({
      where: {
        date: { gte: periode.debut, lte: periode.fin },
        creneau: { saisonId: saison.id },
      },
      include: { creneau: { include: { activite: true, animateurs: true } }, _count: { select: { presences: true } } },
      orderBy: [{ date: "asc" }, { creneau: { heureDebut: "asc" } }],
      take: 60,
    }),
    prisma.seance.findMany({
      where: {
        statut: "PLANIFIEE",
        date: {
          lt: aujourdhui(),
          gte: ajouterJours(aujourdhui(), -JOURS_FEUILLES_MANQUANTES),
        },
        creneau: { saisonId: saison.id },
      },
      select: { id: true, date: true, creneauId: true },
    }),
    decrocheurs(filtre, g.absencesAvantRelance),
    compteur("jour"),
    compteur("semaine"),
    compteur("mois"),
  ]);

  const aTraiter = aValider + enListeAttente;
  // Même règle que la liste « Feuilles non transmises » : une séance sans
  // inscrit attendu ni pointage n'a pas de feuille à réclamer.
  const aEmarger = (await feuillesAttendues(seancesSansEmargement)).length;

  const onglets: { vue: Vue; nombre: number }[] = [
    { vue: "jour", nombre: nbJour },
    { vue: "semaine", nombre: nbSemaine },
    { vue: "mois", nombre: nbMois },
  ];

  return (
    <>
      <PageHeader
        title={`Bonjour ${prenomDe(user.displayName)}`}
        subtitle={`Saison ${saison.nom} — ${fmtDate(saison.debut)} au ${fmtDate(saison.fin)}`}
      >
        <Link href="/statistiques" className={btnSecondary}>
          <TrendingUp className="h-4 w-4" /> Statistiques
        </Link>
        <Link href="/seances" className={btnPrimary}>
          <CalendarDays className="h-4 w-4" /> Planning
        </Link>
      </PageHeader>

      {/* Recherche d'agent : le service des sports part souvent d'une question
          nominative — « est-ce que Untel vient encore ? ». Les suggestions
          mènent directement à la fiche quand on sait déjà qui l'on cherche. */}
      <RechercheRapide />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Chaque indicateur mène à l'écran qui permet d'agir dessus : un
            chiffre qu'on ne peut pas ouvrir laisse chercher où aller. */}
        <Stat
          label="Agents inscrits"
          value={ind.inscrits}
          icon={<Users className="h-4 w-4" />}
          hint={`${ind.agentsUniques} ont participé au moins une fois`}
          href="/inscriptions"
        />
        <Stat
          label="Taux de présence"
          value={ind.tauxPresence}
          suffixe="%"
          accent="text-emerald-600 bg-emerald-50"
          icon={<CalendarCheck className="h-4 w-4" />}
          hint={`${ind.frequentationMoyenne} agents par séance`}
          href="/statistiques"
        />
        <Stat
          label="Inscriptions à traiter"
          value={aTraiter}
          accent={aTraiter > 0 ? "text-amber-600 bg-amber-50" : "text-slate-400 bg-slate-50"}
          icon={<ClipboardCheck className="h-4 w-4" />}
          href="/inscriptions"
          hint={
            aTraiter === 0
              ? "rien en attente"
              : [
                  aValider > 0 ? `${aValider} à arbitrer` : null,
                  enListeAttente > 0 ? `${enListeAttente} en liste d'attente` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
        />
        <Stat
          label="Feuilles non transmises"
          value={aEmarger}
          accent={aEmarger > 0 ? "text-red-600 bg-red-50" : "text-slate-400 bg-slate-50"}
          icon={<AlertTriangle className="h-4 w-4" />}
          hint={`${JOURS_FEUILLES_MANQUANTES} derniers jours`}
          href="/seances?periode=manquantes"
        />
      </div>

      {/* Chaque alerte est une carte entière cliquable, avec son icône : elles
          partagent la même couleur, et c'est l'icône qui les distingue avant
          qu'on ait lu le texte. Une inscription qui attend bloque un agent :
          elle passe avant les indicateurs de fond. */}
      <div className="mb-6">
        {aValider > 0 && (
          <Alerte
            href="/inscriptions#a-decider"
            icon={<ClipboardCheck className="h-5 w-5" />}
            titre={
              <>
                {aValider} {pluriel(aValider, "demande")} d&apos;inscription{" "}
                {pluriel(aValider, "attend", "attendent")} une décision
              </>
            }
            detail="Inscrire, placer en liste d'attente ou refuser."
            action="Arbitrer"
          />
        )}

        {enListeAttente > 0 && (
          <Alerte
            href="/inscriptions"
            icon={<Hourglass className="h-5 w-5" />}
            titre={
              <>
                {enListeAttente} {pluriel(enListeAttente, "agent")}{" "}
                {pluriel(enListeAttente, "est", "sont")} en liste d&apos;attente
              </>
            }
            detail="Ouvrir un créneau, augmenter la capacité, ou prévenir qu'il n'y aura pas de place."
            action="Voir la file"
          />
        )}

        {lachages.length > 0 && (
          <Alerte
            href="/statistiques#decrocheurs"
            icon={<UserX className="h-5 w-5" />}
            titre={
              <>
                {lachages.length} {pluriel(lachages.length, "agent")}{" "}
                {pluriel(lachages.length, "ne vient plus", "ne viennent plus")}
              </>
            }
            detail={`${g.absencesAvantRelance} absences consécutives ou plus : relancer, ou libérer la place.`}
            action="Lister"
          />
        )}

        {aEmarger > 0 && (
          <Alerte
            href="/seances?periode=manquantes"
            icon={<AlertTriangle className="h-5 w-5" />}
            titre={
              <>
                {aEmarger} {pluriel(aEmarger, "feuille")}{" "}
                {pluriel(aEmarger, "non transmise", "non transmises")}
              </>
            }
            detail={`Séances des ${JOURS_FEUILLES_MANQUANTES} derniers jours dont personne n'a envoyé l'émargement.`}
            action="Lister"
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title="Séances"
          className="lg:col-span-2"
          action={
            <Link href="/seances" className="text-xs text-slate-400 hover:text-slate-600">
              Tout le planning
            </Link>
          }
        >
          {/* Onglets en liens : la période choisie reste dans l'URL. */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            {onglets.map((o) => (
              <Link
                key={o.vue}
                href={o.vue === "jour" ? "/" : `/?vue=${o.vue}`}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  vue === o.vue
                    ? "bg-brand-600 text-white"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {VUES[o.vue].label}
                <span
                  className={`ml-1.5 tabular-nums ${vue === o.vue ? "text-brand-100" : "text-slate-400"}`}
                >
                  {o.nombre}
                </span>
              </Link>
            ))}
          </div>

          {seancesPeriode.length === 0 ? (
            <EmptyState title={`Aucune séance — ${VUES[vue].label.toLowerCase()}`} />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {seancesPeriode.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/seances/${s.id}`}
                      className="font-medium hover:text-brand-600"
                    >
                      <span
                        className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ backgroundColor: s.creneau.activite.couleur }}
                      />
                      {s.creneau.activite.nom}
                    </Link>
                    <p className="truncate text-xs text-slate-400">
                      {vue !== "jour" && `${fmtJourCourt(s.date)} · `}
                      {s.creneau.heureDebut}–{s.creneau.heureFin}
                      {s.creneau.lieu ? ` · ${s.creneau.lieu}` : ""}
                      {s.creneau.animateurs.length > 0
                        ? ` · ${s.creneau.animateurs.map((c) => `${c.prenom} ${c.nom}`).join(", ")}`
                        : ""}
                    </p>
                  </div>
                  <Badge color={SEANCE_STATUT_COLORS[s.statut]}>
                    {s.statut === "FAITE"
                      ? `${s._count.presences} ${pluriel(s._count.presences, "pointé")}`
                      : SEANCE_STATUT_LABELS[s.statut]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Fréquentation par activité">
          {activites.length === 0 ? (
            <p className="text-sm text-slate-400">Aucune séance émargée pour l&apos;instant.</p>
          ) : (
            <ul className="space-y-3.5">
              {activites.map((a) => (
                <li key={a.activiteId}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{a.nom}</span>
                    <span className="tabular-nums text-slate-500">
                      {a.moyenne} <span className="text-xs text-slate-400">/séance</span>
                    </span>
                  </div>
                  <Jauge valeur={a.tauxRemplissage} couleur={a.couleur} />
                  <p className="mt-1 text-xs text-slate-400">
                    {a.inscrits} inscrits · {a.tauxRemplissage}% de remplissage
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
