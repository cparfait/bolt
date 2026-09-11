import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  Archive,
  CalendarSync,
  Lock,
  Plus,
  Power,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { saisonDeTravail } from "@/lib/saison";
import { AvertissementPreparation, SelecteurSaison } from "@/components/selecteur-saison";
import {
  basculerActivite,
  regenererCalendrier,
  restaurerCreneau,
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
import { ActiviteForm, BoutonInscriptions } from "@/components/activite-form";
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
  searchParams: Promise<{ creneau?: string; nouveau?: string; saison?: string }>;
}) {
  await requireUser("GESTIONNAIRE");
  const { id } = await params;
  const { creneau: enEdition, nouveau, saison: saisonParam } = await searchParams;
  // La saison choisie dans l'adresse, sinon la courante (voir la liste).
  const saison = await saisonDeTravail(saisonParam);

  const activite = await prisma.activite.findUnique({
    where: { id },
    include: { _count: { select: { creneaux: true } } },
  });
  if (!activite) notFound();

  // L'activité existe, mais aucune saison n'est en cours : ce n'est pas une
  // page introuvable, c'est une étape manquante — et une 404 envoyait chercher
  // une faute de frappe dans l'adresse là où il fallait aller aux paramètres.
  if (!saison) {
    return (
      <>
        <Link
          href="/activites"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Retour aux activités
        </Link>
        <PageHeader title={activite.nom}>
          {!activite.actif && <Badge>Désactivée</Badge>}
        </PageHeader>
        <EmptyState
          title="Aucune saison en cours"
          hint="Les créneaux se rattachent à une saison. Créez-en une, ou activez-en une, dans Paramètres → Saisons & calendrier."
        />
        <p className="mt-4 text-center">
          <Link href="/parametres/saisons" className={btnSecondary}>
            Ouvrir les saisons
          </Link>
        </p>
      </>
    );
  }

  const [creneaux, archives, animateurs, fermetures, effectifs, lieux] =
    await Promise.all([
    prisma.creneau.findMany({
      where: { activiteId: id, saisonId: saison.id, archiveAt: null },
      orderBy: [{ jour: "asc" }, { heureDebut: "asc" }],
      include: {
        animateurs: { select: { id: true, nom: true, prenom: true } },
        fermeturesMaintenues: { select: { id: true, libelle: true } },
        // Qui attend l'ouverture : c'est ce qui dit au service s'il vaut la
        // peine de rouvrir, et à qui le courriel partira.
        alertesOuverture: {
          orderBy: { createdAt: "asc" },
          select: { user: { select: { id: true, displayName: true } } },
        },
        _count: {
          select: { seances: true, inscriptions: { where: { statut: "VALIDEE" } } },
        },
      },
    }),
    // Retirés du planning, pas de l'historique : ils gardent leurs séances
    // émargées, que les statistiques continuent de compter.
    prisma.creneau.findMany({
      where: { activiteId: id, saisonId: saison.id, archiveAt: { not: null } },
      orderBy: [{ jour: "asc" }, { heureDebut: "asc" }],
      include: { _count: { select: { seances: true } } },
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
  const saisons = await prisma.saison.findMany({
    orderBy: { debut: "desc" },
    select: { id: true, nom: true, active: true, debut: true, fin: true },
  });
  /** Adresse de cette fiche, en gardant la saison choisie. */
  const ici = (extra: Record<string, string> = {}, ancre = "") => {
    const q = new URLSearchParams(extra);
    if (saisonParam) q.set("saison", saisonParam);
    const s = q.toString();
    return `/activites/${id}${s ? `?${s}` : ""}${ancre}`;
  };
  const proprietesCreneau = {
    saisonId: saison.id,
    saisonDebut: fmtDate(saison.debut),
    saisonFin: fmtDate(saison.fin),
    bornes: { debut: isoDate(saison.debut), fin: isoDate(saison.fin) },
    fermetures: optionsFermetures,
    activite: {
      id: activite.id,
      nom: activite.nom,
      capacitePartagee: activite.capacitePartagee,
      capacite: activite.capacite,
    },
    animateurs,
    lieux: lieux.map((l) => l.nom),
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
        href={saisonParam ? `/activites?saison=${saisonParam}` : "/activites"}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux activités
      </Link>

      <PageHeader
        title={activite.nom}
        subtitle={`Saison ${saison.nom} — ${creneaux.length} ${pluriel(creneaux.length, "créneau", "créneaux")}`}
      >
        <SelecteurSaison saisons={saisons} selection={saison.id} base={`/activites/${id}`} />
        {!activite.actif && <Badge>Désactivée</Badge>}
        {/* Vérifier les séances générées — et retirer celles qui n'auront pas
            lieu — sans quitter la mise en place de l'activité. */}
        {activite._count.creneaux > 0 && (
          <Link href={`/seances/calendrier?activite=${id}`} className={btnSecondary}>
            <CalendarDays className="h-4 w-4" /> Vue calendrier
          </Link>
        )}
        <BoutonAction action={basculerActivite.bind(null, id)} className={btnSecondary}>
          <Power className="h-4 w-4" />
          {activite.actif ? "Désactiver" : "Réactiver"}
        </BoutonAction>
        <BoutonAction
          action={supprimerActivite.bind(null, id)}
          confirmation={
            activite._count.creneaux === 0
              ? `Supprimer définitivement l'activité « ${activite.nom} » ?`
              : `Retirer l'activité « ${activite.nom} » et ses créneaux ? Les séances à venir sont annulées ; les présences déjà saisies restent comptées dans les statistiques, et l'activité se restaure depuis la liste.`
          }
          className={btnDanger}
        >
          <Trash2 className="h-4 w-4" /> Supprimer
        </BoutonAction>
      </PageHeader>
      <AvertissementPreparation saison={saison} />

      <div className="mb-6 h-1.5 rounded-full" style={{ backgroundColor: activite.couleur }} />

      <Panneau titre="Fiche de l'activité" sousTitre="Nom, description, couleur">
        <ActiviteForm
          saisonId={saison.id}
          initiale={{
            id: activite.id,
            nom: activite.nom,
            description: activite.description,
            couleur: activite.couleur,
            capacitePartagee: activite.capacitePartagee,
            capacite: activite.capacite,
            suiviPresence: activite.suiviPresence,
          }}
        />
      </Panneau>

      {groupe && (
        <Card title="Groupe unique" className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-slate-600">
              {creneaux.length > 1
                ? `Les ${creneaux.length} créneaux de cette activité se partagent`
                : "Le créneau de cette activité relève"}{" "}
              d&apos;un seul groupe : un agent peut suivre une séance, plusieurs
              ou toutes sans occuper plusieurs places. La liste d&apos;attente est
              commune.
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
                          <Badge color="bg-amber-100 text-amber-800 ring-amber-500/20">
                            <Lock className="h-3 w-3" aria-hidden="true" />
                            Inscriptions fermées
                          </Badge>
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
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
                    {/* Les agents qui ont demandé à être prévenus de la
                        réouverture : nommés, parce que le service les
                        connaît, et liés à leur fiche. Ils recevront le
                        courriel au clic sur « Ouvrir ». */}
                    {!c.ouvertInscription && c.alertesOuverture.length > 0 && (
                      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-brand-700">
                        <Bell className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="font-medium">
                          {c.alertesOuverture.length}{" "}
                          {pluriel(c.alertesOuverture.length, "agent attend", "agents attendent")}{" "}
                          l&apos;ouverture :
                        </span>
                        {c.alertesOuverture.map((a, i) => (
                          <span key={a.user.id}>
                            <Link href={`/agents/${a.user.id}`} className="hover:underline">
                              {a.user.displayName}
                            </Link>
                            {i < c.alertesOuverture.length - 1 ? "," : ""}
                          </span>
                        ))}
                      </p>
                    )}
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
                      href={enEdition === c.id ? ici() : ici({ creneau: c.id }, "#creneau")}
                      scroll={false}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                        enEdition === c.id
                          ? "border-brand-300 bg-brand-50 text-brand-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {enEdition === c.id ? "Fermer" : "Modifier"}
                    </Link>
                    {/* Composant dédié : il affiche le compte rendu de
                        l'ouverture — qui a été prévenu —, ce qu'un bouton
                        d'action muet ne pouvait pas rendre. */}
                    <BoutonInscriptions
                      creneauId={c.id}
                      ouvert={c.ouvertInscription}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                    />
                    <BoutonAction
                      action={regenererCalendrier.bind(null, c.id)}
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-500 transition hover:bg-slate-50"
                      title="Regénérer le calendrier des séances"
                    >
                      <CalendarSync className="h-3.5 w-3.5" />
                    </BoutonAction>
                    <BoutonAction
                      action={supprimerCreneau.bind(null, c.id)}
                      confirmation="Supprimer ce créneau ? Ses séances à venir sont retirées du calendrier ; ce qui a déjà été émargé reste compté dans les statistiques."
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
                    className="mt-4 scroll-mt-20 rounded-xl border-2 border-brand-200 bg-brand-50/30 p-5"
                  >
                    <CreneauForm
                      {...proprietesCreneau}
                      initial={{
                        id: c.id,
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

      {archives.length > 0 && (
        <Card title="Créneaux retirés" className="mt-6">
          <p className="mb-3 text-sm text-slate-500">
            Ils ne sont plus au planning et n&apos;acceptent plus d&apos;inscription.
            Leurs séances émargées restent comptées dans les statistiques de la
            saison.
          </p>
          <ul className="divide-y divide-slate-100">
            {archives.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-medium text-slate-600">
                    <Archive className="h-3.5 w-3.5 text-slate-400" />
                    {JOUR_LABELS[c.jour]} {c.heureDebut}–{c.heureFin}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {[
                      c.lieu,
                      `${c._count.seances} ${pluriel(c._count.seances, "séance")} conservée${c._count.seances > 1 ? "s" : ""}`,
                      c.archiveAt ? `retiré le ${fmtDate(c.archiveAt)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <BoutonAction
                  action={restaurerCreneau.bind(null, c.id)}
                  confirmation="Remettre ce créneau au planning ? Ses séances à venir sont regénérées."
                  className={btnSecondary}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Restaurer
                </BoutonAction>
              </li>
            ))}
          </ul>
        </Card>
      )}

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
        <Link href={ici({ nouveau: "1" }, "#nouveau")} className={btnSecondary} scroll={false}>
          <Plus className="h-4 w-4" /> Nouveau créneau
        </Link>
      </div>
    </>
  );
}
