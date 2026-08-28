import { CalendarCheck, CalendarOff, Info, MapPin, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
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
import { getTextesLegaux } from "@/lib/declarations";
import { FiltreActivites } from "@/components/filtre-activites";
import { effectifsParActivite } from "@/lib/inscriptions";
import {
  ETAT_COLORS,
  ETAT_COURT,
  INSCRIPTION_STATUT_COLORS,
  INSCRIPTION_STATUT_LABELS,
  pluriel,
} from "@/lib/constants";

export default async function MesActivitesPage({
  searchParams,
}: {
  searchParams: Promise<{ activite?: string }>;
}) {
  const user = await requireUser();
  const { activite: selection } = await searchParams;
  const saison = await saisonCourante();
  const g = await getGeneralSettings();
  // Les déclarations et mentions présentées avant l'inscription, dans leur
  // version en vigueur (Paramètres → Déclarations).
  const textes = await getTextesLegaux();

  if (!saison) {
    return (
      <>
        <PageHeader title="Mes activités" />
        <EmptyState title="Aucune saison n'est ouverte pour l'instant" />
      </>
    );
  }

  const [creneaux, mesInscriptions, mesPresences] = await Promise.all([
    prisma.creneau.findMany({
      where: { saisonId: saison.id, activite: { actif: true } },
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

  const [nbFermetures, effectifs] = await Promise.all([
    prisma.fermeture.count({ where: { saisonId: saison.id } }),
    effectifsParActivite(saison.id),
  ]);
  const parCreneau = new Map(mesInscriptions.map((i) => [i.creneauId, i]));

  // Le quota se compte en activités pratiquées : suivre la musculation le lundi
  // et le jeudi reste une seule activité, et un créneau supplémentaire sur une
  // activité déjà suivie ne consomme rien.
  const activitesEngagees = new Set(mesInscriptions.map((i) => i.creneau.activiteId));
  const nbEngagements = activitesEngagees.size;
  const quotaAtteint =
    g.maxInscriptionsParAgent > 0 && nbEngagements >= g.maxInscriptionsParAgent;

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
        title="Mes activités"
        subtitle={`Saison ${saison.nom} — ${creneaux.length} créneaux proposés`}
      />

      {/* Pas d'agenda ici : cette page sert à choisir une activité. Les
          prochaines séances et la déclaration d'absence vivent au tableau de
          bord, qui est l'écran que l'agent ouvre pour « voir ce qui m'attend ». */}
      {mesInscriptions.length > 0 && (
        <Card title="Mes inscriptions" className="mb-6">
          <ul className="divide-y divide-slate-100">
            {mesInscriptions.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  {/* Le nom porte la couleur de l'activité, comme au catalogue
                      en dessous et sur la page Inscriptions : c'est le même
                      repère d'un écran à l'autre. */}
                  <p
                    className="text-sm font-medium"
                    style={{ color: i.creneau.activite.couleur }}
                  >
                    {i.creneau.activite.nom}
                  </p>
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

      {quotaAtteint && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            Vous êtes positionné sur {nbEngagements} activité
            {nbEngagements > 1 ? "s" : ""}, soit le maximum autorisé cette saison.
            Désinscrivez-vous d&apos;une activité pour en choisir une autre.
          </p>
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Catalogue
      </h2>

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
            const bloqueParQuota = quotaAtteint && !activitesEngagees.has(activite.id);
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
                        couleur={groupeComplet ? "#dc2626" : activite.couleur}
                      />
                    </div>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {liste.map((c) => {
                    const inscrits = c._count.inscriptions;
                    const complet = groupe ? groupeComplet : inscrits >= c.capacite;
                    const mienne = parCreneau.get(c.id);
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
                              couleur={complet ? "#dc2626" : activite.couleur}
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
                  <p className="font-medium">{p.seance.creneau.activite.nom}</p>
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
