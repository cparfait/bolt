import Link from "next/link";
import { CalendarCheck, CalendarOff, Info, MapPin, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAgent } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import { getGeneralSettings } from "@/lib/settings";
import { aujourdhui, ajouterJours, fmtDateLongue, JOUR_LABELS } from "@/lib/dates";
import {
  Badge,
  Card,
  EmptyState,
  Jauge,
  PageHeader,
} from "@/components/ui";
import { DesinscrireForm, InscrireForm } from "@/components/inscription-agent";
import { MesSeances } from "@/components/mes-seances";
import { prochainesSeancesDe } from "@/lib/actions/absences";
import { getTextesLegaux } from "@/lib/declarations";
import { FiltreActivites } from "@/components/filtre-activites";
import { effectifsParActivite, refusDeQuota } from "@/lib/inscriptions";
import {
  ETAT_COLORS,
  ETAT_COURT,
  INSCRIPTION_STATUT_COLORS,
  INSCRIPTION_STATUT_LABELS,
  pluriel,
} from "@/lib/constants";

/**
 * Teinte d'une jauge pleine. Grise, et non plus rouge : un créneau complet
 * n'est pas une anomalie, c'est une information — et le rouge, sur une carte
 * déjà teintée aux couleurs de l'activité, criait une alerte là où le bouton
 * juste en dessous propose tranquillement la liste d'attente. Le décompte
 * « 10 / 10 places » dit déjà ce qu'il faut savoir.
 */
const COMPLET = "#94a3b8";

export default async function MesActivitesPage({
  searchParams,
}: {
  searchParams: Promise<{ activite?: string }>;
}) {
  const user = await requireAgent();
  const { activite: selection } = await searchParams;
  const saison = await saisonCourante();
  const g = await getGeneralSettings();
  // Les déclarations et mentions présentées avant l'inscription, dans leur
  // version en vigueur (Paramètres → Déclarations).
  const textes = await getTextesLegaux();

  if (!saison) {
    return (
      <>
        <PageHeader title="Activités" />
        <EmptyState title="Aucune saison n'est ouverte pour l'instant" />
      </>
    );
  }

  const [creneaux, mesInscriptions, mesPresences] = await Promise.all([
    prisma.creneau.findMany({
      where: { saisonId: saison.id, archiveAt: null, activite: { actif: true } },
      include: {
        activite: true,
        animateurs: { select: { prenom: true, nom: true } },
        fermeturesMaintenues: { select: { id: true } },
        _count: { select: { inscriptions: { where: { statut: "VALIDEE" } } } },
      },
      orderBy: [{ activite: { ordre: "asc" } }, { jour: "asc" }, { heureDebut: "asc" }],
    }),
    prisma.inscription.findMany({
      where: {
        userId: user.id,
        creneau: { saisonId: saison.id },
        statut: { in: ["VALIDEE", "EN_ATTENTE", "LISTE_ATTENTE"] },
      },
      include: { creneau: { include: { activite: true } } },
    }),
    prisma.presence.findMany({
      where: {
        userId: user.id,
        seance: { date: { gte: ajouterJours(aujourdhui(), -60) } },
      },
      include: { seance: { include: { creneau: { include: { activite: true } } } } },
      orderBy: { seance: { date: "desc" } },
      take: 12,
    }),
  ]);

  const [nbFermetures, effectifs, prochaines] = await Promise.all([
    prisma.fermeture.count({ where: { saisonId: saison.id } }),
    effectifsParActivite(saison.id),
    prochainesSeancesDe(user.id, 60),
  ]);
  const parCreneau = new Map(mesInscriptions.map((i) => [i.creneauId, i]));

  // Même règle qu'au serveur, et par le même code : un catalogue qui propose un
  // bouton que l'action refusera ensuite est pire qu'un catalogue qui grise.
  // Le quota se compte par créneau, et la liste d'attente à part (voir
  // `refusDeQuota`) — d'où deux verdicts, selon que le créneau visé a de la
  // place ou non.
  const engagements = {
    actifs: mesInscriptions.filter((i) => i.statut !== "LISTE_ATTENTE").length,
    attente: mesInscriptions.filter((i) => i.statut === "LISTE_ATTENTE").length,
  };
  const quotaAtteint = refusDeQuota(g, engagements, false) !== null;
  const filesEpuisees = refusDeQuota(g, engagements, true) !== null;

  // Activités où l'agent occupe déjà une place : en groupe unique, il peut y
  // ajouter une séance même si le groupe est complet.
  const activitesAvecPlace = new Set(
    mesInscriptions.filter((i) => i.statut === "VALIDEE").map((i) => i.creneau.activiteId),
  );

  // Regroupement par activité : l'agent choisit d'abord un sport, puis un horaire.
  const parActivite = new Map<string, typeof creneaux>();
  for (const c of creneaux) {
    parActivite.set(c.activiteId, [...(parActivite.get(c.activiteId) ?? []), c]);
  }

  const presencesVenues = mesPresences.filter(
    (p) => p.etat === "PRESENT",
  ).length;

  return (
    <>
      <PageHeader
        title="Activités"
        subtitle={`Saison ${saison.nom} — ${creneaux.length} créneaux proposés`}
      />

      {mesInscriptions.length > 0 && (
        <Card title="Mes inscriptions" className="mb-6">
          <ul className="divide-y divide-slate-100">
            {mesInscriptions.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  {/* Le nom porte la couleur de l'activité, comme au catalogue
                      en dessous et sur la page Inscriptions : c'est le même
                      repère d'un écran à l'autre. */}
                  <Link
                    href={`/mes-activites?activite=${i.creneau.activiteId}`}
                    className="text-sm font-medium hover:underline"
                    style={{ color: i.creneau.activite.couleur }}
                  >
                    {i.creneau.activite.nom}
                  </Link>
                  <p className="text-xs text-slate-400">
                    {JOUR_LABELS[i.creneau.jour]} {i.creneau.heureDebut}–
                    {i.creneau.heureFin}
                    {i.creneau.lieu ? ` · ${i.creneau.lieu}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={INSCRIPTION_STATUT_COLORS[i.statut]}>
                    {i.statut === "LISTE_ATTENTE"
                      ? `${INSCRIPTION_STATUT_LABELS[i.statut]} — n°${i.rang}`
                      : INSCRIPTION_STATUT_LABELS[i.statut]}
                  </Badge>
                  <DesinscrireForm id={i.id} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* L'agenda est ici ET sur le tableau de bord, délibérément.
          Il n'a d'abord vécu que sur le tableau de bord, où l'agent va « voir ce
          qui m'attend » — un bon raisonnement, démenti à l'usage. Le service des
          sports et les animateurs n'ont pas ce tableau de bord mais celui de la
          gestion, et n'avaient donc aucun moyen de se déclarer absents. Et
          l'agent lui-même cherche ses séances dans « Mes activités », puisque
          c'est là qu'il vient de s'inscrire — sur téléphone surtout, où l'on ne
          voit qu'un écran à la fois et où le menu est replié.
          Le même composant, la même source : ce n'est pas un doublon à tenir à
          jour, c'est une seconde porte sur la même pièce. */}
      {/* Affichée même vide, et c'est le point : masquée faute de séance, la
          carte laissait croire que l'application ne sait pas prévenir d'une
          absence — alors qu'elle dit seulement qu'on n'est inscrit à rien. Son
          état vide renvoie au catalogue, qui est juste en dessous. */}
      <div className="mb-6">
        <MesSeances seances={prochaines} />
      </div>

      {quotaAtteint && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            Vous occupez {engagements.actifs} créneau
            {engagements.actifs > 1 ? "x" : ""}, soit le maximum autorisé cette
            saison. Désinscrivez-vous d&apos;un créneau pour en choisir un autre
            {filesEpuisees
              ? "."
              : " — vous pouvez en revanche vous mettre en liste d'attente sur un créneau complet."}
          </p>
        </div>
      )}

      <div className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Catalogue de la saison
        </h2>
        <p className="mt-0.5 text-sm text-slate-400">
          Toutes les activités proposées, y compris celles où vous n&apos;êtes pas
          inscrit.
        </p>
      </div>

      <FiltreActivites
        base="/mes-activites"
        selection={selection}
        activites={[...parActivite.values()].map((l) => ({
          id: l[0].activite.id,
          nom: l[0].activite.nom,
          couleur: l[0].activite.couleur,
          actif: true,
        }))}
      />

      {creneaux.length === 0 ? (
        <EmptyState title="Aucun créneau proposé pour l'instant" />
      ) : (
        <div className="mb-8 space-y-4">
          {[...parActivite.values()]
            .filter((l) => !selection || l[0].activiteId === selection)
            .map((liste) => {
            const activite = liste[0].activite;
            // Groupe unique : une seule série de places pour tous les créneaux.
            // L'agent choisit les séances qui l'arrangent — une, plusieurs ou
            // toutes — sans occuper plusieurs places.
            const groupe = activite.capacitePartagee
              ? {
                  capacite: activite.capacite ?? 0,
                  inscrits: effectifs.get(activite.id) ?? 0,
                }
              : null;
            const groupeComplet =
              groupe !== null &&
              groupe.inscrits >= groupe.capacite &&
              !activitesAvecPlace.has(activite.id);
            return (
              /* Même traitement que la page Inscriptions : liseré plus fond
                 très pâle aux couleurs de l'activité. Avec plusieurs activités
                 à la suite, le seul liseré ne suffisait pas à rattacher une
                 grille de créneaux à son activité — le regard décroche entre
                 le titre et le bas de la carte. Les créneaux restent sur fond
                 blanc, pour qu'ils se détachent de la teinte. */
              <Card
                key={activite.id}
                className="border-l-4"
                style={{
                  borderLeftColor: activite.couleur,
                  backgroundColor: `${activite.couleur}0f`,
                }}
              >
                <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3
                      className="text-lg font-semibold tracking-tight"
                      style={{ color: activite.couleur }}
                    >
                      {activite.nom}
                    </h3>
                    {activite.description && (
                      <p className="mt-1 text-sm text-slate-500">{activite.description}</p>
                    )}
                    {groupe && (
                      <p className="mt-1 text-xs text-slate-500">
                        {liste.length > 1
                          ? `${liste.length} créneaux proposés au même groupe : inscrivez-vous à ceux qui vous conviennent, une seule place est retenue.`
                          : "Un seul groupe pour cette activité : votre place vous suit sur tous ses créneaux."}
                      </p>
                    )}
                  </div>
                  {groupe && (
                    <div className="w-40 shrink-0">
                      <p className="mb-1 flex items-center gap-1 text-xs tabular-nums text-slate-500">
                        <Users className="h-3 w-3" />
                        {groupe.inscrits} / {groupe.capacite} places
                      </p>
                      <Jauge
                        valeur={
                          groupe.capacite > 0
                            ? (groupe.inscrits / groupe.capacite) * 100
                            : 0
                        }
                        couleur={groupeComplet ? COMPLET : activite.couleur}
                      />
                    </div>
                  )}
                </div>
                {/* Une seule colonne quand l'activité n'a qu'un créneau : à
                    deux colonnes, la moitié droite restait un grand aplat
                    teinté et vide, qui se lisait comme un bloc manquant. */}
                <div className={`grid gap-3 ${liste.length > 1 ? "sm:grid-cols-2" : ""}`}>
                  {liste.map((c) => {
                    const inscrits = c._count.inscriptions;
                    const complet = groupe ? groupeComplet : inscrits >= c.capacite;
                    const mienne = parCreneau.get(c.id);
                    // Un créneau complet mène à la file d'attente, qui a son
                    // propre plafond : c'est celui-là qu'il faut interroger, et
                    // non le quota d'inscriptions.
                    const bloqueParQuota = complet ? filesEpuisees : quotaAtteint;
                    return (
                      <div
                        key={c.id}
                        className="rounded-xl border border-slate-200 bg-white p-4"
                      >
                        <p className="font-medium">
                          {JOUR_LABELS[c.jour]} · {c.heureDebut}–{c.heureFin}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                          <MapPin className="h-3 w-3" />
                          {c.lieu ?? "lieu à préciser"}
                          {c.animateurs.length > 0 &&
                            ` · ${c.animateurs.map((a) => `${a.prenom} ${a.nom}`).join(", ")}`}
                        </p>
                        {/* L'agent doit savoir avant de s'inscrire si l'activité
                            s'arrête aux vacances : c'est un critère de choix. */}
                        {nbFermetures > 0 && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs">
                            <CalendarOff className="h-3 w-3 shrink-0" />
                            {c.fermeturesMaintenues.length === 0 ? (
                              <span className="text-slate-400">
                                pas de séance pendant les vacances scolaires
                              </span>
                            ) : c.fermeturesMaintenues.length === nbFermetures ? (
                              <span className="font-medium text-emerald-700">
                                séances maintenues pendant les vacances
                              </span>
                            ) : (
                              <span className="text-emerald-700">
                                séances maintenues sur {c.fermeturesMaintenues.length} des{" "}
                                {nbFermetures} périodes de vacances
                              </span>
                            )}
                          </p>
                        )}

                        <div className="my-3">
                          <p className="mb-1 flex items-center gap-1 text-xs tabular-nums text-slate-500">
                            <Users className="h-3 w-3" />
                            {groupe
                              ? `${inscrits} ${pluriel(inscrits, "inscrit")} à ce créneau`
                              : `${inscrits} / ${c.capacite} places`}
                          </p>
                          {!groupe && (
                            <Jauge
                              valeur={(inscrits / c.capacite) * 100}
                              couleur={complet ? COMPLET : activite.couleur}
                            />
                          )}
                        </div>

                        {mienne ? (
                          <p className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs font-medium text-slate-500">
                            {mienne.statut === "VALIDEE"
                              ? "Vous êtes inscrit"
                              : mienne.statut === "LISTE_ATTENTE"
                                ? `En liste d'attente (n°${mienne.rang})`
                                : "Demande en cours"}
                          </p>
                        ) : !c.ouvertInscription ? (
                          <p className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs text-slate-400">
                            Inscriptions fermées
                          </p>
                        ) : bloqueParQuota ? (
                          <p className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs text-slate-400">
                            Quota atteint
                          </p>
                        ) : (
                          <InscrireForm
                            creneauId={c.id}
                            complet={complet}
                            couleur={activite.couleur}
                            intitule={`${activite.nom} · ${JOUR_LABELS[c.jour]} ${c.heureDebut}–${c.heureFin}`}
                            textes={textes}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {mesPresences.length > 0 && (
        <Card
          title="Mon historique"
          action={
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <CalendarCheck className="h-3.5 w-3.5" />
              {presencesVenues} séance{presencesVenues > 1 ? "s" : ""} suivie
              {presencesVenues > 1 ? "s" : ""}
            </span>
          }
        >
          <ul className="divide-y divide-slate-100 text-sm">
            {mesPresences.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  {/* Le nom porte sa couleur, comme partout ailleurs : sur un
                      historique où les mêmes intitulés se répètent, c'est elle
                      qu'on suit du regard plutôt que de relire chaque ligne.

                      Et il filtre l'écran sur son activité : devant une liste
                      qui mélange trois sports, la question suivante est
                      toujours « et celui-là, ça donne quoi ? ». Le nom est déjà
                      ce qu'on vise du doigt — autant qu'il réponde. */}
                  <Link
                    href={`/mes-activites?activite=${p.seance.creneau.activiteId}`}
                    className="font-medium hover:underline"
                    style={{ color: p.seance.creneau.activite.couleur }}
                  >
                    {p.seance.creneau.activite.nom}
                  </Link>
                  <p className="text-xs text-slate-400">{fmtDateLongue(p.seance.date)}</p>
                </div>
                <Badge color={ETAT_COLORS[p.etat]}>{ETAT_COURT[p.etat]}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
