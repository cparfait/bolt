import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarX2, Mail } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import { aujourdhui, fmtDate, fmtDateLongue, fmtHorodatage, JOUR_LABELS } from "@/lib/dates";
import { effectifsParActivite } from "@/lib/inscriptions";
import { adresseDeContact, estHorsAnnuaire } from "@/lib/comptes";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { EmailAgentForm, RattacherAdForm } from "@/components/agent-identite-forms";
import { RetirerForm } from "@/components/inscription-actions";
import { Panneau } from "@/components/panneau";
import {
  AbsencePourAgent,
  InscrireDepuisFiche,
  RetirerAbsence,
} from "@/components/fiche-agent-actions";
import {
  ETAT_COLORS,
  ETAT_COURT,
  INSCRIPTION_STATUT_COLORS,
  INSCRIPTION_STATUT_LABELS,
  ROLE_LABELS,
  pluriel,
} from "@/lib/constants";

/** Fiche d'un agent : ce à quoi il est inscrit, et s'il vient réellement. */
export default async function FicheAgent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fusion?: string }>;
}) {
  await requireUser("GESTIONNAIRE");
  const { id } = await params;
  const { fusion } = await searchParams;
  const saison = await saisonCourante();

  const agent = await prisma.user.findUnique({ where: { id } });
  if (!agent) notFound();

  // Les indicateurs portent sur la saison affichée, comme les inscriptions
  // juste à côté — et se comptent en base plutôt que sur la liste ci-dessous,
  // qui s'arrête aux trente derniers pointages : au-delà, « séances suivies »
  // et « taux de présence » se seraient tus sur le reste de la saison.
  const perimetre = saison ? { seance: { creneau: { saisonId: saison.id } } } : {};

  const [
    inscriptions,
    presences,
    venues,
    manquees,
    absencesAVenir,
    creneauxSaison,
    seancesAVenir,
  ] = await Promise.all([
    prisma.inscription.findMany({
      where: { userId: id, ...(saison ? { creneau: { saisonId: saison.id } } : {}) },
      include: { creneau: { include: { activite: true } } },
      orderBy: { demandeAt: "desc" },
    }),
    prisma.presence.findMany({
      where: { userId: id, ...perimetre },
      include: { seance: { include: { creneau: { include: { activite: true } } } } },
      orderBy: { seance: { date: "desc" } },
      take: 30,
    }),
    prisma.presence.count({ where: { userId: id, etat: "PRESENT", ...perimetre } }),
    prisma.presence.count({ where: { userId: id, etat: "ABSENT", ...perimetre } }),
    prisma.absenceAnnoncee.findMany({
      where: { userId: id, seance: { date: { gte: aujourdhui() } } },
      include: { seance: { include: { creneau: { include: { activite: true } } } } },
      orderBy: { seance: { date: "asc" } },
    }),
    saison
      ? prisma.creneau.findMany({
          where: { saisonId: saison.id },
          include: {
            activite: { select: { nom: true, capacitePartagee: true, capacite: true } },
            _count: { select: { inscriptions: { where: { statut: "VALIDEE" } } } },
          },
          orderBy: [{ activite: { nom: "asc" } }, { jour: "asc" }, { heureDebut: "asc" }],
        })
      : Promise.resolve([]),
    // Séances à venir sur lesquelles l'agent est inscrit : ce sont les seules
    // pour lesquelles une absence a du sens.
    prisma.seance.findMany({
      where: {
        statut: { not: "ANNULEE" },
        clotureeAt: null,
        date: { gte: aujourdhui() },
        creneau: { inscriptions: { some: { userId: id, statut: "VALIDEE" } } },
        absences: { none: { userId: id } },
      },
      include: { creneau: { include: { activite: true } } },
      orderBy: [{ date: "asc" }, { creneau: { heureDebut: "asc" } }],
      take: 30,
    }),
  ]);

  const dejaPositionne = new Set(
    inscriptions
      .filter((i) => ["VALIDEE", "LISTE_ATTENTE", "EN_ATTENTE"].includes(i.statut))
      .map((i) => i.creneauId),
  );
  // En groupe unique, le remplissage se lit sur l'activité : le compteur du
  // créneau ne dirait pas si le groupe a encore de la place.
  const effectifs = saison ? await effectifsParActivite(saison.id) : new Map();
  const creneauxProposables = creneauxSaison
    .filter((c) => !dejaPositionne.has(c.id))
    .map((c) => ({
      id: c.id,
      label: `${c.activite.nom} — ${JOUR_LABELS[c.jour]} ${c.heureDebut} (${
        c.activite.capacitePartagee
          ? `groupe ${effectifs.get(c.activiteId) ?? 0}/${c.activite.capacite ?? 0}`
          : `${c._count.inscriptions}/${c.capacite}`
      })`,
    }));
  const seancesProposables = seancesAVenir.map((s) => ({
    id: s.id,
    label: `${s.creneau.activite.nom} — ${fmtDateLongue(s.date)} ${s.creneau.heureDebut}`,
  }));

  const pointages = venues + manquees;
  const taux = pointages > 0 ? Math.round((venues / pointages) * 100) : 0;

  // Un participant créé à la main : son identité n'appartient à aucun annuaire,
  // c'est donc ici qu'elle se corrige. Les comptes locaux sont dans le même cas
  // pour l'adresse, mais ils n'ont pas vocation à rejoindre l'Active Directory.
  const horsAnnuaire = estHorsAnnuaire(agent.login);
  const contact = adresseDeContact(agent);

  return (
    <>
      <Link
        href="/agents"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Retour à la recherche
      </Link>

      <PageHeader
        title={agent.displayName}
        subtitle={[agent.login, agent.service, agent.direction].filter(Boolean).join(" · ")}
      >
        <Badge>{ROLE_LABELS[agent.role]}</Badge>
        {horsAnnuaire && (
          <Badge color="bg-amber-100 text-amber-800 ring-amber-500/20">
            Hors annuaire
          </Badge>
        )}
        {!agent.active && <Badge>Compte désactivé</Badge>}
        {contact && (
          <a
            href={`mailto:${contact}`}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-600"
          >
            <Mail className="h-4 w-4" /> {contact}
          </a>
        )}
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Inscriptions"
          value={inscriptions.filter((i) => i.statut === "VALIDEE").length}
          hint={saison ? `saison ${saison.nom}` : undefined}
        />
        <Stat label="Séances suivies" value={venues} accent="text-emerald-600 bg-emerald-50" />
        <Stat
          label="Taux de présence"
          value={taux}
          suffixe="%"
          hint={`${manquees} ${pluriel(manquees, "absence")} sur ${pointages} ${pluriel(pointages, "séance pointée", "séances pointées")}`}
        />
        <Stat
          label="Dernière connexion"
          value={agent.lastLoginAt ? fmtDate(agent.lastLoginAt) : "jamais"}
        />
      </div>

      {fusion && (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm text-emerald-800">
          Fiches fusionnées. L&apos;historique du participant hors annuaire a été
          repris sur ce compte, et l&apos;agent le retrouvera à sa prochaine
          connexion.
        </div>
      )}

      {/* Ouvert pour tout agent, y compris ceux de l'annuaire : c'est le seul
          moyen de joindre celui qui ne consulte pas sa boîte professionnelle. */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Panneau
          titre="Adresse de contact"
          sousTitre={
            agent.email
              ? "Prime sur celle de l'annuaire, sans l'écraser"
              : "Aucune adresse connue : sans elle, Bolt ne peut rien lui envoyer"
          }
        >
          <EmailAgentForm
            userId={agent.id}
            emailContact={agent.emailContact}
            emailAnnuaire={agent.email}
          />
        </Panneau>
        {horsAnnuaire && (
          <Panneau
            titre="Rattacher à un compte Active Directory"
            sousTitre="Son compte a fini par être créé"
          >
            <RattacherAdForm userId={agent.id} />
          </Panneau>
        )}
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Panneau
          titre="Inscrire à une activité"
          sousTitre="Pour une demande reçue par un autre canal"
        >
          <InscrireDepuisFiche login={agent.login} creneaux={creneauxProposables} />
        </Panneau>
        <Panneau
          titre="Signaler une absence"
          sousTitre="L'agent a prévenu par téléphone ou au bureau"
        >
          <AbsencePourAgent userId={agent.id} seances={seancesProposables} />
        </Panneau>
      </div>

      {absencesAVenir.length > 0 && (
        <Card
          title="Absences annoncées"
          className="mb-6"
          action={
            <span className="flex items-center gap-1.5 text-xs text-amber-600">
              <CalendarX2 className="h-3.5 w-3.5" /> séances à venir
            </span>
          }
        >
          <ul className="divide-y divide-slate-100 text-sm">
            {absencesAVenir.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-medium">{a.seance.creneau.activite.nom}</p>
                  <p className="text-xs text-slate-400">
                    <span className="first-letter:uppercase">
                      {fmtDateLongue(a.seance.date)}
                    </span>{" "}
                    · {a.seance.creneau.heureDebut}
                    {a.motif ? ` — « ${a.motif} »` : ""}
                  </p>
                </div>
                <RetirerAbsence seanceId={a.seanceId} userId={agent.id} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Inscriptions">
          {inscriptions.length === 0 ? (
            <EmptyState title="Aucune inscription cette saison" />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {inscriptions.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">{i.creneau.activite.nom}</p>
                    <p className="text-xs text-slate-400">
                      {JOUR_LABELS[i.creneau.jour]} {i.creneau.heureDebut}–
                      {i.creneau.heureFin}
                      {i.motif ? ` · ${i.motif}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge color={INSCRIPTION_STATUT_COLORS[i.statut]}>
                      {i.statut === "LISTE_ATTENTE"
                        ? `${INSCRIPTION_STATUT_LABELS[i.statut]} n°${i.rang}`
                        : INSCRIPTION_STATUT_LABELS[i.statut]}
                    </Badge>
                    {["VALIDEE", "LISTE_ATTENTE"].includes(i.statut) && (
                      <RetirerForm id={i.id} nom={agent.displayName} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Historique de présence"
          action={
            pointages > presences.length ? (
              <span className="text-xs text-slate-400">
                {presences.length} derniers sur {pointages}
              </span>
            ) : null
          }
        >
          {presences.length === 0 ? (
            <EmptyState title="Aucune séance émargée pour cet agent" />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {presences.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">{p.seance.creneau.activite.nom}</p>
                    <p className="text-xs text-slate-400">
                      {fmtDate(p.seance.date)}
                      {p.saisiAt ? ` · pointé le ${fmtHorodatage(p.saisiAt)}` : ""}
                    </p>
                  </div>
                  <Badge color={ETAT_COLORS[p.etat]}>{ETAT_COURT[p.etat]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
