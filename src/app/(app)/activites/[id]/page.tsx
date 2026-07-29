import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarSync, Plus, Power, Trash2, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import {
  basculerActivite,
  basculerInscriptions,
  regenererCalendrier,
  supprimerActivite,
  supprimerCreneau,
} from "@/lib/actions/activites";
import {
  Badge,
  Card,
  EmptyState,
  Jauge,
  PageHeader,
  btnDanger,
  btnSecondary,
} from "@/components/ui";
import { Panneau } from "@/components/panneau";
import { BoutonAction } from "@/components/bouton-action";
import { ActiviteForm } from "@/components/activite-form";
import { CreneauForm } from "@/components/creneau-form";
import { fmtDate, isoDate, JOUR_LABELS } from "@/lib/dates";
import { effectifsParActivite } from "@/lib/inscriptions";
import { pluriel } from "@/lib/constants";

/**
 * Page de gestion d'une activité : sa fiche et tous ses créneaux au même
 * endroit. Le formulaire de créneau y dispose de la largeur nécessaire —
 * notamment pour la liste des périodes de vacances, illisible dans un panneau
 * flottant.
 */
export default async function ActiviteDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ creneau?: string; nouveau?: string }>;
}) {
  await requireUser("GESTIONNAIRE");
  const { id } = await params;
  const { creneau: enEdition, nouveau } = await searchParams;
  const saison = await saisonCourante();

  const activite = await prisma.activite.findUnique({
    where: { id },
    include: { _count: { select: { creneaux: true } } },
  });
  if (!activite || !saison) notFound();

  const [creneaux, animateurs, fermetures, effectifs, lieux] = await Promise.all([
    prisma.creneau.findMany({
      where: { activiteId: id, saisonId: saison.id },
      orderBy: [{ jour: "asc" }, { heureDebut: "asc" }],
      include: {
        animateurs: { select: { id: true, nom: true, prenom: true } },
        fermeturesMaintenues: { select: { id: true, libelle: true } },
        _count: {
          select: { seances: true, inscriptions: { where: { statut: "VALIDEE" } } },
        },
      },
    }),
    prisma.coach.findMany({
      where: { actif: true },
      orderBy: [{ nom: "asc" }],
      select: { id: true, nom: true, prenom: true },
    }),
    prisma.fermeture.findMany({
      where: { saisonId: saison.id },
      orderBy: { debut: "asc" },
    }),
    effectifsParActivite(saison.id),
    prisma.lieu.findMany({
      where: { actif: true },
      orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      select: { nom: true },
    }),
  ]);

  const optionsFermetures = fermetures.map((f) => ({
    id: f.id,
    libelle: f.libelle,
    periode: `${fmtDate(f.debut)} → ${fmtDate(f.fin)}`,
  }));
  const base = `/activites/${id}`;
  const proprietesCreneau = {
    saisonId: saison.id,
    saisonDebut: fmtDate(saison.debut),
    saisonFin: fmtDate(saison.fin),
    fermetures: optionsFermetures,
    activites: [
      {
        id: activite.id,
        nom: activite.nom,
        capacitePartagee: activite.capacitePartagee,
        capacite: activite.capacite,
      },
    ],
    animateurs,
    lieux: lieux.map((l) => l.nom),
    activiteId: activite.id,
  };

  // Capacité mutualisée : le remplissage se lit sur l'activité, pas créneau par
  // créneau — un agent présent le lundi et le jeudi n'occupe qu'une place.
  const groupe = activite.capacitePartagee
    ? {
        capacite: activite.capacite ?? 0,
        inscrits: effectifs.get(activite.id) ?? 0,
      }
    : null;

  return (
    <>
      <Link
        href="/activites"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux activités
      </Link>

      <PageHeader
        title={activite.nom}
        subtitle={`Saison ${saison.nom} — ${creneaux.length} ${pluriel(creneaux.length, "créneau", "créneaux")}`}
      >
        {!activite.actif && <Badge>Désactivée</Badge>}
        <BoutonAction action={basculerActivite.bind(null, id)} className={btnSecondary}>
          <Power className="h-4 w-4" />
          {activite.actif ? "Désactiver" : "Réactiver"}
        </BoutonAction>
        {activite._count.creneaux === 0 && (
          <BoutonAction
            action={supprimerActivite.bind(null, id)}
            confirmation={`Supprimer définitivement l'activité « ${activite.nom} » ?`}
            className={btnDanger}
          >
            <Trash2 className="h-4 w-4" /> Supprimer
          </BoutonAction>
        )}
      </PageHeader>

      <div className="mb-6 h-1.5 rounded-full" style={{ backgroundColor: activite.couleur }} />

      <Panneau titre="Fiche de l'activité" sousTitre="Nom, description, couleur">
        <ActiviteForm
          initiale={{
            id: activite.id,
            nom: activite.nom,
            description: activite.description,
            couleur: activite.couleur,
            capacitePartagee: activite.capacitePartagee,
            capacite: activite.capacite,
          }}
        />
      </Panneau>

      {groupe && (
        <Card title="Groupe unique" className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-slate-600">
              Les {creneaux.length} {pluriel(creneaux.length, "créneau", "créneaux")} de
              cette activité se partagent un seul groupe : un agent peut suivre une
              séance, plusieurs ou toutes sans occuper plusieurs places. La liste
              d&apos;attente est commune.
            </p>
            <div className="w-48 shrink-0">
              <p className="mb-1 flex items-center gap-1.5 text-sm tabular-nums text-slate-600">
                <Users className="h-4 w-4" />
                {groupe.inscrits} / {groupe.capacite} agents
              </p>
              <Jauge
                valeur={groupe.capacite > 0 ? (groupe.inscrits / groupe.capacite) * 100 : 0}
                couleur={activite.couleur}
              />
            </div>
          </div>
        </Card>
      )}

      <Card title="Créneaux hebdomadaires" className="mt-6">
        {creneaux.length === 0 ? (
          <EmptyState
            title="Aucun créneau cette saison"
            hint="Une activité 2×/semaine se décrit avec deux créneaux."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {creneaux.map((c) => (
              <li key={c.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {JOUR_LABELS[c.jour]} {c.heureDebut}–{c.heureFin}
                      {!c.ouvertInscription && (
                        <span className="ml-2">
                          <Badge>Inscriptions fermées</Badge>
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">
                      {[
                        c.lieu,
                        c.animateurs.length > 0
                          ? c.animateurs.map((a) => `${a.prenom} ${a.nom}`).join(", ")
                          : "animateur à désigner",
                        `${c._count.seances} séances`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {(c.dateDebut || c.dateFin) && (
                      <p className="text-xs font-medium text-amber-600">
                        {c.dateDebut ? `du ${fmtDate(c.dateDebut)}` : "dès l'ouverture"}
                        {c.dateFin ? ` au ${fmtDate(c.dateFin)}` : " à la fin de saison"}
                      </p>
                    )}
                    {fermetures.length > 0 && (
                      <p className="text-xs">
                        {c.fermeturesMaintenues.length === 0 ? (
                          <span className="text-slate-500">
                            fermé pendant les {fermetures.length} périodes de vacances
                          </span>
                        ) : c.fermeturesMaintenues.length === fermetures.length ? (
                          <span className="font-medium text-emerald-700">
                            ouvert toute l&apos;année, vacances comprises
                          </span>
                        ) : (
                          <span className="text-emerald-700">
                            ouvert pendant{" "}
                            {c.fermeturesMaintenues.map((f) => f.libelle).join(", ")}
                          </span>
                        )}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <div className="w-32">
                      <p className="mb-1 flex items-center gap-1.5 text-xs tabular-nums text-slate-500">
                        <Users className="h-3.5 w-3.5" />
                        {groupe
                          ? `${c._count.inscriptions} sur cette séance`
                          : `${c._count.inscriptions} / ${c.capacite} inscrits`}
                      </p>
                      {!groupe && (
                        <Jauge
                          valeur={(c._count.inscriptions / c.capacite) * 100}
                          couleur={activite.couleur}
                        />
                      )}
                    </div>
                    <Link
                      href={enEdition === c.id ? base : `${base}?creneau=${c.id}#creneau`}
                      scroll={false}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                        enEdition === c.id
                          ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {enEdition === c.id ? "Fermer" : "Modifier"}
                    </Link>
                    <BoutonAction
                      action={basculerInscriptions.bind(null, c.id)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                    >
                      {c.ouvertInscription ? "Fermer les inscriptions" : "Ouvrir"}
                    </BoutonAction>
                    <BoutonAction
                      action={regenererCalendrier.bind(null, c.id)}
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-500 transition hover:bg-slate-50"
                      title="Regénérer le calendrier des séances"
                    >
                      <CalendarSync className="h-3.5 w-3.5" />
                    </BoutonAction>
                    <BoutonAction
                      action={supprimerCreneau.bind(null, c.id)}
                      confirmation="Supprimer ce créneau et ses séances non émargées ?"
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                      title="Supprimer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </BoutonAction>
                  </div>
                </div>

                {enEdition === c.id && (
                  <div
                    id="creneau"
                    className="mt-4 scroll-mt-20 rounded-xl border-2 border-indigo-200 bg-indigo-50/30 p-5"
                  >
                    <CreneauForm
                      {...proprietesCreneau}
                      initial={{
                        id: c.id,
                        activiteId: activite.id,
                        animateurs: c.animateurs.map((a) => a.id),
                        jour: c.jour,
                        heureDebut: c.heureDebut,
                        heureFin: c.heureFin,
                        lieu: c.lieu,
                        capacite: c.capacite,
                        ouvertInscription: c.ouvertInscription,
                        dateDebut: c.dateDebut ? isoDate(c.dateDebut) : null,
                        dateFin: c.dateFin ? isoDate(c.dateFin) : null,
                        fermeturesMaintenues: c.fermeturesMaintenues.map((f) => f.id),
                        nbInscrits: c._count.inscriptions,
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-6" id="nouveau">
        <Panneau
          titre={`Ajouter un créneau à ${activite.nom}`}
          sousTitre="Une activité 2×/semaine = deux créneaux"
          ouvert={creneaux.length === 0 || nouveau === "1"}
        >
          <CreneauForm {...proprietesCreneau} />
        </Panneau>
      </div>

      <div className="mt-4">
        <Link href={`${base}?nouveau=1#nouveau`} className={btnSecondary} scroll={false}>
          <Plus className="h-4 w-4" /> Nouveau créneau
        </Link>
      </div>
    </>
  );
}
