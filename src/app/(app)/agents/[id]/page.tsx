import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarX2, History, Mail } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { saisonCourante } from "@/lib/saison";
import { aujourdhui, fmtDate, fmtDateLongue, fmtHorodatage, JOUR_LABELS } from "@/lib/dates";
import { effectifsParActivite } from "@/lib/inscriptions";
import { adresseDeContact, estCreeALaMain, estHorsAnnuaire } from "@/lib/comptes";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import {
  EmailAgentForm,
  RattacherAdForm,
  ServiceAgentForm,
} from "@/components/agent-identite-forms";
import { RetirerForm } from "@/components/inscription-actions";
import { Panneau } from "@/components/panneau";
import {
  AbsencePourAgent,
  DesactiverAgent,
  InscrireDepuisFiche,
  ReactiverAgent,
  RetirerAbsence,
  SupprimerIdentite,
} from "@/components/fiche-agent-actions";
import { compterInscriptionsVivantes } from "@/lib/departs";
import { journalDe } from "@/lib/journal";
import { servicesProposes } from "@/lib/services";
import {
  ETAT_COLORS,
  ETAT_COURT,
  INSCRIPTION_STATUT_COLORS,
  INSCRIPTION_STATUT_LABELS,
  ROLE_LABELS,
  pluriel,
} from "@/lib/constants";

/**
 * Fiche d'un agent : ce à quoi il est inscrit, et s'il vient réellement.
 *
 * ── L'ordre de l'écran ────────────────────────────────────────────────────
 *
 * Ce qu'on vient lire d'abord, ce qu'on vient faire ensuite, ce qui est rare
 * tout en bas. La fiche présentait l'inverse : sept blocs dépliables — service,
 * adresse, rattachement, inscrire, absence, départ, suppression — empilés sur
 * toute la largeur avant la moindre information, si bien qu'il fallait faire
 * défiler un mur de titres gris pour apprendre à quoi la personne est inscrite.
 * Or on ouvre une fiche pour savoir, et seulement ensuite pour agir.
 *
 * Les inscriptions, les présences et le journal passent donc devant, et les
 * sept panneaux se rangent dans une seule zone « Gérer ce compte », en grille :
 * un bloc visuel au lieu de sept barres. Aucun n'a été retiré — ils gardent
 * leur titre et leur sous-titre, qui disent déjà ce qu'ils font.
 */
/**
 * Lignes de journal affichées. Assez pour couvrir la vie récente d'un compte —
 * une inscription, quelques absences, une correction de service — sans faire de
 * la fiche un écran de journal : le journal complet est dans Paramètres.
 */
const JOURNAL_AFFICHE = 25;

export default async function FicheAgent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fusion?: string }>;
}) {
  const utilisateur = await requireUser("GESTIONNAIRE");
  const { id } = await params;
  const { fusion } = await searchParams;
  const saison = await saisonCourante();

  const agent = await prisma.user.findUnique({ where: { id } });
  if (!agent) notFound();

  // Compté toutes saisons confondues, contrairement aux inscriptions affichées
  // plus bas : un départ retire aussi les positions prises sur la saison
  // suivante, et la case à cocher doit annoncer ce qu'elle fait réellement.
  const inscriptionsVivantes = await compterInscriptionsVivantes(id);

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
    servicesReferentiel,
    miroirAd,
    journal,
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
          where: { saisonId: saison.id, archiveAt: null },
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
    servicesProposes(),
    // Le libellé brut de l'annuaire, pour dire d'où vient le service affiché.
    prisma.adAccount.findFirst({
      where: { samAccountName: { equals: agent.login, mode: "insensitive" } },
      select: { service: true },
    }),
    journalDe(id, JOURNAL_AFFICHE),
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
  // Sans pointage, pas de taux : « 0 % » se lisait « ne vient jamais » pour un
  // agent qui n'a simplement pas encore eu de séance — même règle que sur la
  // feuille d'une séance.
  const taux = pointages > 0 ? Math.round((venues / pointages) * 100) : null;

  // Un participant créé à la main : son identité n'appartient à aucun annuaire,
  // c'est donc ici qu'elle se corrige. Les comptes locaux sont dans le même cas
  // pour l'adresse, mais ils n'ont pas vocation à rejoindre l'Active Directory.
  // Classement : l'ancien préfixe « ext. » compte aussi.
  const horsAnnuaire = estCreeALaMain(agent.login);
  // La suppression d'identité est irréversible : elle reste à la DSI.
  const estAdmin = utilisateur.role === "ADMIN";
  // Droit d'écrire l'adresse de contact : liste blanche stricte, parce qu'elle
  // commande l'envoi du lien de connexion — voir modifierEmailAgent.
  const adresseModifiable = estHorsAnnuaire(agent.login);
  const contact = adresseDeContact(agent);

  return (
    <>
      <Link
        href="/agents"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Retour à la recherche
      </Link>

      {/* La provenance d'un participant hors annuaire est dite par le badge
          juste à côté : son identifiant technique n'a rien à faire dans le
          sous-titre, et y écrire « hors annuaire » le répéterait. */}
      <PageHeader
        title={agent.displayName}
        subtitle={[horsAnnuaire ? null : agent.login, agent.service, agent.direction]
          .filter(Boolean)
          .join(" · ")}
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
          value={taux ?? "—"}
          suffixe={taux === null ? undefined : "%"}
          hint={
            taux === null
              ? "aucune séance pointée pour l'instant"
              : `${manquees} ${pluriel(manquees, "absence")} sur ${pointages} ${pluriel(pointages, "séance pointée", "séances pointées")}`
          }
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

      {agent.anonymiseAt && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-500">
          Identité supprimée le {fmtDate(agent.anonymiseAt)}. Les inscriptions et
          les présences ci-dessous restent comptées dans les statistiques, sans
          nom.
        </div>
      )}

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
                  <p className="text-xs text-slate-500">
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
                    <p className="text-xs text-slate-500">
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
              <span className="text-xs text-slate-500">
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
                    <p className="text-xs text-slate-500">
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

      {/* Le journal ferme la lecture : il explique ce que les cartes du dessus
          montrent sans le dire — pourquoi une inscription est désistée, qui a
          fermé l'accès, quand l'adresse a changé. Sans lui, la réponse à
          « pourquoi ne suis-je plus inscrit ? » demandait d'ouvrir le journal
          de la DSI et d'y chercher un nom à la main. */}
      <Card
        title="Journal du compte"
        className="mt-6"
        action={
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <History className="h-3.5 w-3.5" />
            {/* « les N derniers » n'a de sens que si la liste est tronquée :
                trois lignes affichées sur trois, ce sont les trois, pas les
                trois dernières. */}
            {journal.length === JOURNAL_AFFICHE
              ? `${JOURNAL_AFFICHE} derniers événements`
              : `${journal.length} ${pluriel(journal.length, "événement")}`}
          </span>
        }
      >
        {journal.length === 0 ? (
          <EmptyState
            title="Rien au journal pour ce compte"
            hint="Les connexions, inscriptions et décisions le concernant s'inscriront ici."
          />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {journal.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <span className="w-32 shrink-0 tabular-nums text-xs text-slate-500">
                  {fmtHorodatage(l.quand)}
                </span>
                <span className="font-medium">{l.libelle}</span>
                {l.cible && <span className="text-slate-500">{l.cible}</span>}
                {l.details && (
                  <span className="text-xs text-slate-500">{l.details}</span>
                )}
                {/* Nul quand c'est l'agent lui-même : le répéter à chaque ligne
                    noierait les rares où quelqu'un d'autre est intervenu. */}
                {l.acteur && (
                  <span className="text-xs text-slate-500">par {l.acteur}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Tout ce qui modifie le compte, en un seul endroit et en grille. Ces
          panneaux étaient dispersés sur toute la hauteur de la fiche, chacun
          sur sa propre ligne : sept barres grises fermées qu'il fallait
          traverser avant d'atteindre la moindre information. */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Gérer ce compte
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
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

          {/* Le service reste en tête des blocs d'identité : c'est la question
              qu'on se pose devant une fiche, et le sous-titre y répond sans
              même l'ouvrir. Le formulaire sert quand l'annuaire retarde. */}
          <Panneau
            titre="Service"
            sousTitre={
              agent.service
                ? `${agent.service}${agent.serviceForce ? " — décidé à la main" : ""}`
                : "Aucun service connu"
            }
          >
            <ServiceAgentForm
              userId={agent.id}
              service={agent.service}
              force={agent.serviceForce}
              brut={miroirAd?.service ?? null}
              services={servicesReferentiel}
            />
          </Panneau>
          {/* Modifiable pour les seuls participants hors annuaire. L'adresse
              d'un compte AD vient de l'annuaire : la saisir ici permettrait de
              détourner son lien de connexion — voir modifierEmailAgent. */}
          <Panneau
            titre="Adresse de contact"
            sousTitre={
              !horsAnnuaire
                ? "Celle de l'annuaire, en lecture seule"
                : agent.emailContact || agent.email
                  ? "Elle commande tout ce que l'application lui envoie"
                  : "Aucune adresse connue : sans elle, l'application ne peut rien lui envoyer"
            }
          >
            <EmailAgentForm
              userId={agent.id}
              emailContact={agent.emailContact}
              emailAnnuaire={agent.email}
              modifiable={adresseModifiable}
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

          {/* Départ et suppression en dernier : gestes rares, et l'un vient
              après l'autre dans la vie d'un compte. La suppression d'identité
              est irréversible et reste à la DSI ; une fiche déjà anonymisée
              n'affiche rien, il n'y a plus d'identité à effacer. */}
          <Panneau
            titre={agent.active ? "Départ de l'agent" : "Compte désactivé"}
            sousTitre={
              agent.active
                ? "Fermer son accès, et rendre ses places"
                : "Il ne peut plus se connecter"
            }
          >
            {agent.active ? (
              <DesactiverAgent
                userId={agent.id}
                nom={agent.displayName}
                inscriptions={inscriptionsVivantes}
              />
            ) : (
              <ReactiverAgent userId={agent.id} />
            )}
          </Panneau>
          {estAdmin && !agent.anonymiseAt && (
            <Panneau
              titre="Supprimer l'identité"
              sousTitre="À la demande de la personne, ou au terme de la conservation"
            >
              <SupprimerIdentite userId={agent.id} nom={agent.displayName} />
            </Panneau>
          )}
        </div>
      </section>
    </>
  );
}
