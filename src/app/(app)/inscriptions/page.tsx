import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import { fmtDate } from "@/lib/dates";
import { JOUR_LABELS } from "@/lib/dates";
import {
  Badge,
  Card,
  EmptyState,
  Jauge,
  PageHeader,
  Stat,
} from "@/components/ui";
import { Panneau } from "@/components/panneau";
import { FiltreActivites } from "@/components/filtre-activites";
import { DecisionForm, RetirerForm } from "@/components/inscription-actions";
import { RechercheAgent } from "@/components/recherche-agent";
import { AgentHorsAnnuaireForm } from "@/components/agent-hors-annuaire-form";
import { effectifsParActivite } from "@/lib/inscriptions";
import {
  INSCRIPTION_STATUT_COLORS,
  INSCRIPTION_STATUT_LABELS,
  pluriel,
} from "@/lib/constants";

export default async function InscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ activite?: string }>;
}) {
  await requireUser("GESTIONNAIRE");
  const { activite: selection } = await searchParams;
  const saison = await saisonCourante();

  if (!saison) {
    return (
      <>
        <PageHeader title="Inscriptions" />
        <EmptyState title="Aucune saison configurée" />
      </>
    );
  }

  const [creneaux, demandes, effectifs] = await Promise.all([
    prisma.creneau.findMany({
      where: { saisonId: saison.id },
      include: {
        activite: true,
        inscriptions: {
          where: { statut: { in: ["VALIDEE", "LISTE_ATTENTE"] } },
          include: { user: true },
          orderBy: [{ statut: "asc" }, { rang: "asc" }],
        },
      },
      orderBy: [{ activite: { nom: "asc" } }, { jour: "asc" }, { heureDebut: "asc" }],
    }),
    prisma.inscription.findMany({
      where: { statut: "EN_ATTENTE", creneau: { saisonId: saison.id } },
      include: { user: true, creneau: { include: { activite: true } } },
      orderBy: { demandeAt: "asc" },
    }),
    effectifsParActivite(saison.id),
  ]);

  // Une activité à groupe unique n'offre ses places qu'une fois, et son inscrit
  // ne se compte qu'une fois même s'il suit deux séances : ses créneaux sont
  // donc mis de côté dans les totaux, remplacés par l'activité elle-même.
  const groupes = [
    ...new Map(
      creneaux
        .filter((c) => c.activite.capacitePartagee)
        .map((c) => [c.activiteId, c.activite]),
    ).values(),
  ];
  const creneauxDistincts = creneaux.filter((c) => !c.activite.capacitePartagee);

  const totalInscrits =
    creneauxDistincts.reduce(
      (n, c) => n + c.inscriptions.filter((i) => i.statut === "VALIDEE").length,
      0,
    ) + groupes.reduce((n, a) => n + (effectifs.get(a.id) ?? 0), 0);
  const totalAttente = creneaux.reduce(
    (n, c) => n + c.inscriptions.filter((i) => i.statut === "LISTE_ATTENTE").length,
    0,
  );
  // Même repli que `perimetreCapacite` : une activité déclarée à groupe unique
  // sans effectif retombe sur la capacité de son créneau, plutôt que sur zéro.
  const capaciteGroupe = (a: { id: string; capacite: number | null }) =>
    a.capacite ??
    creneaux.find((c) => c.activiteId === a.id)?.capacite ??
    0;
  const capaciteTotale =
    creneauxDistincts.reduce((n, c) => n + c.capacite, 0) +
    groupes.reduce((n, a) => n + capaciteGroupe(a), 0);
  // Un créneau peut dépasser sa capacité (inscription forcée, ajout à la
  // volée) : « −3 disponibles » n'a pas de sens, il n'y a plus de place.
  const disponibles = Math.max(0, capaciteTotale - totalInscrits);

  // Le filtre ne porte que sur la liste des créneaux : les demandes à arbitrer
  // restent toutes visibles, c'est la file de travail du service.
  const creneauxAffiches = selection
    ? creneaux.filter((c) => c.activiteId === selection)
    : creneaux;

  const optionsCreneaux = creneaux.map((c) => ({
    id: c.id,
    label: `${c.activite.nom} — ${JOUR_LABELS[c.jour]} ${c.heureDebut} (${
      c.activite.capacitePartagee
        ? `groupe ${effectifs.get(c.activiteId) ?? 0}/${c.activite.capacite ?? 0}`
        : `${c.inscriptions.filter((i) => i.statut === "VALIDEE").length}/${c.capacite}`
    })`,
  }));

  const palette = [
    ...new Map(
      creneaux.map((c) => [
        c.activiteId,
        { id: c.activiteId, nom: c.activite.nom, couleur: c.activite.couleur, actif: true },
      ]),
    ).values(),
  ];

  return (
    <>
      <PageHeader title="Inscriptions" subtitle={`Saison ${saison.nom}`} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Demandes à traiter"
          value={demandes.length}
          accent={
            demandes.length > 0 ? "text-amber-600 bg-amber-50" : "text-slate-400 bg-slate-50"
          }
        />
        <Stat label="Inscrits" value={totalInscrits} />
        <Stat label="Liste d'attente" value={totalAttente} />
        <Stat
          label="Places offertes"
          value={capaciteTotale}
          hint={`${disponibles} ${pluriel(disponibles, "disponible")}`}
          href="/activites"
        />
      </div>

      <Card title="Demandes en attente de décision" className="mb-6">
        {demandes.length === 0 ? (
          <p className="text-sm text-slate-400">Aucune demande à traiter.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {demandes.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/agents/${d.userId}`}
                    className="text-sm font-medium hover:text-brand-600"
                  >
                    {d.user.displayName}
                  </Link>
                  <p className="text-xs text-slate-400">
                    {d.creneau.activite.nom} · {JOUR_LABELS[d.creneau.jour]}{" "}
                    {d.creneau.heureDebut} · demandé le {fmtDate(d.demandeAt)}
                    {d.user.service ? ` · ${d.user.service}` : ""}
                  </p>
                  {d.commentaire && (
                    <p className="mt-1 text-xs italic text-slate-500">
                      « {d.commentaire} »
                    </p>
                  )}
                </div>
                <DecisionForm id={d.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mb-6 space-y-3">
        <Panneau
          titre="Inscrire un agent directement"
          sousTitre="Pour une demande reçue par un autre canal"
        >
          <RechercheAgent creneaux={optionsCreneaux} />
        </Panneau>

        {/* Tout le monde n'a pas de compte AD : élus, CCAS, apprentis en attente
            d'ouverture de compte, association partenaire. Sans cette porte, ces
            participants n'existent ni sur les feuilles ni dans le bilan. */}
        <Panneau
          titre="Créer un participant hors annuaire"
          sousTitre="Élu, agent d'un autre organisme, stagiaire sans compte AD"
        >
          <AgentHorsAnnuaireForm creneaux={optionsCreneaux} />
        </Panneau>
      </div>

      <FiltreActivites base="/inscriptions" selection={selection} activites={palette} />

      {creneauxAffiches.length === 0 ? (
        <EmptyState title="Aucun créneau à afficher" />
      ) : (
        <div className="space-y-4">
          {creneauxAffiches.map((c) => {
            const inscrits = c.inscriptions.filter((i) => i.statut === "VALIDEE");
            const attente = c.inscriptions.filter((i) => i.statut === "LISTE_ATTENTE");
            // Groupe unique : la jauge suit le remplissage de l'activité, pas
            // celui de la séance — sinon un agent venant deux fois compterait
            // deux places.
            const groupe = c.activite.capacitePartagee
              ? {
                  capacite: c.activite.capacite ?? 0,
                  inscrits: effectifs.get(c.activiteId) ?? 0,
                }
              : null;
            return (
              /* Fond teinté de la couleur de l'activité : avec deux créneaux
                 par activité et six activités, un liseré ne suffisait pas à
                 voir d'un coup d'œil à quoi se rattache une liste d'inscrits.
                 La liste des inscrits reprend la même teinte en plus soutenu
                 (1f contre 0f) : elle se détache toujours de la carte, sans
                 le pavé blanc qui cassait la couleur au milieu du bloc. */
              <Card
                key={c.id}
                className="border-l-4"
                style={{
                  borderLeftColor: c.activite.couleur,
                  backgroundColor: `${c.activite.couleur}0f`,
                }}
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">
                      <span style={{ color: c.activite.couleur }}>{c.activite.nom}</span>
                      {" — "}
                      {JOUR_LABELS[c.jour]} {c.heureDebut}–{c.heureFin}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {c.lieu ?? "lieu non précisé"} ·{" "}
                      {c.ouvertInscription ? "inscriptions ouvertes" : "inscriptions fermées"}
                      {groupe && " · groupe partagé avec les autres créneaux"}
                    </p>
                  </div>
                  <div className="w-40">
                    <p className="mb-1 text-right text-xs tabular-nums text-slate-500">
                      {groupe
                        ? `${inscrits.length} sur ce créneau · groupe ${groupe.inscrits}/${groupe.capacite}`
                        : `${inscrits.length} / ${c.capacite}`}
                    </p>
                    <Jauge
                      valeur={
                        groupe
                          ? groupe.capacite > 0
                            ? (groupe.inscrits / groupe.capacite) * 100
                            : 0
                          : (inscrits.length / c.capacite) * 100
                      }
                      couleur={c.activite.couleur}
                      fond="#ffffff"
                    />
                  </div>
                </div>

                {inscrits.length === 0 ? (
                  <p
                    style={{ backgroundColor: `${c.activite.couleur}1f` }}
                    className="rounded-xl px-4 py-3 text-sm text-slate-500"
                  >
                    Aucun inscrit.
                  </p>
                ) : (
                  <ul
                    style={{ backgroundColor: `${c.activite.couleur}1f` }}
                    className="divide-y rounded-xl px-3 text-sm"
                  >
                    {inscrits.map((i) => (
                      <li
                        key={i.id}
                        /* La couleur du filet se pose ici et non via
                           `divide-*` : elle dépend de l'activité, donc hors
                           palette Tailwind. `divide-y` ne pose la bordure
                           qu'à partir du deuxième élément, la première ligne
                           n'en hérite pas. */
                        style={{ borderTopColor: `${c.activite.couleur}33` }}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        {/* Le nom mène à la fiche : « est-ce que Untel vient
                            encore ? » se pose en lisant une liste d'inscrits. */}
                        <Link
                          href={`/agents/${i.userId}`}
                          className="min-w-0 rounded px-1 -mx-1 hover:text-brand-600"
                        >
                          {i.user.displayName}
                          {i.user.service && (
                            <span className="ml-2 text-xs text-slate-500">
                              {i.user.service}
                            </span>
                          )}
                        </Link>
                        <RetirerForm id={i.id} nom={i.user.displayName} />
                      </li>
                    ))}
                  </ul>
                )}

                {attente.length > 0 && (
                  /* Bloc neutre et non plus bleu : sur une carte teintée, le
                     bleu fixe entrait en conflit avec la couleur de l'activité
                     — et frontalement avec celle du créneau Musculation. Le
                     statut est déjà porté par le badge de chaque ligne. */
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white/70 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Liste d&apos;attente — {attente.length}{" "}
                      {pluriel(attente.length, "personne")}
                      {groupe && " · file commune à l'activité"}
                    </p>
                    <ul className="space-y-1 text-sm">
                      {attente.map((i) => (
                        <li key={i.id} className="flex items-center justify-between gap-3">
                          <Link
                            href={`/agents/${i.userId}`}
                            className="min-w-0 hover:text-brand-600"
                          >
                            <span className="mr-2 tabular-nums text-slate-400">
                              {i.rang}.
                            </span>
                            {i.user.displayName}
                          </Link>
                          <div className="flex items-center gap-2">
                            <Badge color={INSCRIPTION_STATUT_COLORS[i.statut]}>
                              {INSCRIPTION_STATUT_LABELS[i.statut]}
                            </Badge>
                            <RetirerForm id={i.id} nom={i.user.displayName} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
