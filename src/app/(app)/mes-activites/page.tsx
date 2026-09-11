import Link from "next/link";
import { CalendarCheck, CalendarDays, CalendarOff, Check, Info, Lock, MapPin, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAgent } from "@/lib/session";
import { saisonOuverte } from "@/lib/saison";
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
import { prochainesSeancesDe } from "@/lib/absences";
import { adressesDesLieux, itineraireDe } from "@/lib/lieux";
import { Itineraire } from "@/components/itineraire";
import { AlerteOuverture } from "@/components/alerte-ouverture";
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
  // La saison activée, et rien d'autre : une saison en préparation n'est pas
  // un catalogue. Voir `saisonOuverte` (src/lib/saison.ts).
  const saison = await saisonOuverte();
  const g = await getGeneralSettings();
  // Les déclarations et mentions présentées avant l'inscription, dans leur
  // version en vigueur (Paramètres → Déclarations).
  const textes = await getTextesLegaux();

  if (!saison) {
    return (
      <>
        <PageHeader title="Activités" />
        <EmptyState
          title="Aucune saison n'est ouverte pour l'instant"
          hint={
            g.contactEmail
              ? `Le service des sports ouvre les inscriptions en début de saison. Pour toute question : ${g.contactEmail}`
              : "Le service des sports ouvre les inscriptions en début de saison."
          }
        />
      </>
    );
  }

  const [creneaux, mesInscriptions, mesPresences] = await Promise.all([
    prisma.creneau.findMany({
      where: { saisonId: saison.id, archiveAt: null, activite: { actif: true } },
      include: {
        activite: true,
        fermeturesMaintenues: { select: { id: true } },
        _count: { select: { inscriptions: { where: { statut: "VALIDEE" } } } },
      },
      orderBy: [{ jour: "asc" }, { heureDebut: "asc" }],
    }).then((liste) =>
      // Ordre alphabétique des activités, trié ici et non en base : la
      // collation du conteneur PostgreSQL range les majuscules et les accents
      // à sa façon (« Éveil » après « Zumba »), pas à celle d'un lecteur
      // français. Le tri est stable : jour et heure restent ordonnés dedans.
      liste.sort((a, b) => a.activite.nom.localeCompare(b.activite.nom, "fr")),
    ),
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

  const [nbFermetures, effectifs, prochaines, adresses, prochainesSeances, attentes] =
    await Promise.all([
      prisma.fermeture.count({ where: { saisonId: saison.id } }),
      effectifsParActivite(saison.id),
      prochainesSeancesDe(user.id, 60),
      adressesDesLieux(),
      // La première séance à venir de chaque créneau : « jeudi » ne dit pas si
      // l'on commence cette semaine ou après les vacances, la date le dit.
      prisma.seance.findMany({
        where: {
          creneauId: { in: creneaux.map((c) => c.id) },
          statut: "PLANIFIEE",
          date: { gte: aujourdhui() },
        },
        orderBy: { date: "asc" },
        distinct: ["creneauId"],
        select: { creneauId: true, date: true },
      }),
      // La file d'attente, pour dire « Complet · 3 en attente » plutôt qu'un
      // « Complet » sec qui laisse deviner ses chances.
      prisma.inscription.findMany({
        where: { statut: "LISTE_ATTENTE", creneau: { saisonId: saison.id, archiveAt: null } },
        select: { creneauId: true, userId: true, creneau: { select: { activiteId: true } } },
      }),
    ]);
  const parCreneau = new Map(mesInscriptions.map((i) => [i.creneauId, i]));
  const prochaineSeanceDe = new Map(prochainesSeances.map((s) => [s.creneauId, s.date]));
  // Créneaux fermés sur lesquels l'agent a demandé à être prévenu.
  const mesAlertes = new Set(
    (
      await prisma.alerteOuverture.findMany({
        where: { userId: user.id },
        select: { creneauId: true },
      })
    ).map((a) => a.creneauId),
  );
  const attenteParCreneau = new Map<string, number>();
  const attenteParActivite = new Map<string, Set<string>>();
  for (const a of attentes) {
    attenteParCreneau.set(a.creneauId, (attenteParCreneau.get(a.creneauId) ?? 0) + 1);
    const ensemble = attenteParActivite.get(a.creneau.activiteId) ?? new Set<string>();
    ensemble.add(a.userId);
    attenteParActivite.set(a.creneau.activiteId, ensemble);
  }

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
        <Card title="Mes inscriptions" className="mb-6" id="mes-inscriptions">
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
                  <p className="text-xs text-slate-700">
                    {JOUR_LABELS[i.creneau.jour]} {i.creneau.heureDebut}–
                    {i.creneau.heureFin}
                    {i.creneau.lieu ? ` · ${i.creneau.lieu}` : ""}
                    {itineraireDe(i.creneau.lieu, adresses) && (
                      <>
                        {" "}
                        <Itineraire href={itineraireDe(i.creneau.lieu, adresses)} />
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={INSCRIPTION_STATUT_COLORS[i.statut]}>
                    {i.statut === "LISTE_ATTENTE"
                      ? `${INSCRIPTION_STATUT_LABELS[i.statut]} n°${i.rang}`
                      : INSCRIPTION_STATUT_LABELS[i.statut]}
                  </Badge>
                  <DesinscrireForm
                    id={i.id}
                    intitule={`${i.creneau.activite.nom} (${JOUR_LABELS[i.creneau.jour]} ${i.creneau.heureDebut})`}
                  />
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
      {/* Affichée dès qu'une inscription existe, même sans séance à venir :
          entre deux périodes de vacances, l'agent doit voir que l'application
          sait prévenir d'une absence. Tant qu'il n'est inscrit à rien, elle
          n'annonce qu'un vide, juste au-dessus d'un catalogue qui dit déjà
          quoi faire — on la retire. */}
      {mesInscriptions.length > 0 && (
        <div className="mb-6">
          <MesSeances seances={prochaines} />
        </div>
      )}

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
            // Ce qu'on lit en balayant la page, avant la description : combien
            // de créneaux, combien de places, où. Le chiffre qui décide est
            // celui des places libres, en vert ; complet, il passe en ambre
            // avec la longueur de la file — un « Complet » sec laisse deviner
            // ses chances, « 3 en attente » les dit.
            const placesLibres = groupe
              ? Math.max(0, groupe.capacite - groupe.inscrits)
              : liste.reduce((n, c) => n + Math.max(0, c.capacite - c._count.inscriptions), 0);
            const enAttente = attenteParActivite.get(activite.id)?.size ?? 0;
            const lieux = [...new Set(liste.map((c) => c.lieu).filter(Boolean))];
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
                <div className="mb-4">
                  <div>
                    <h3
                      className="text-lg font-semibold tracking-tight"
                      style={{ color: activite.couleur }}
                    >
                      {activite.nom}
                    </h3>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-700">
                      <span>
                        {liste.length} {pluriel(liste.length, "créneau", "créneaux")}
                        {groupe ? `, un seul groupe de ${groupe.capacite}` : ""}
                      </span>
                      <span className="text-slate-300">·</span>
                      {placesLibres > 0 ? (
                        <span className="font-semibold text-brand-600">
                          {placesLibres} {pluriel(placesLibres, "place libre", "places libres")}
                        </span>
                      ) : (
                        <span className="font-semibold text-amber-700">
                          Complet
                          {enAttente > 0 ? ` · ${enAttente} en attente` : ""}
                        </span>
                      )}
                      {/* Le lieu en tête seulement s'il vaut pour plusieurs
                          créneaux : avec un seul, il est déjà juste dessous. */}
                      {/* Un seul lieu pour toute l'activité : il se dit ici,
                          avec son itinéraire, et pas sous chaque créneau. */}
                      {lieux.length === 1 && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            {lieux[0]}
                          </span>
                          <Itineraire href={itineraireDe(lieux[0], adresses)} />
                        </>
                      )}
                    </p>
                    {activite.description && (
                      <p className="mt-1 text-sm text-slate-500">{activite.description}</p>
                    )}
                    {/* Aucun créneau ouvert : le dire une fois en tête plutôt
                        que de laisser l'agent lire « Inscriptions fermées »
                        sur chaque créneau pour le comprendre. */}
                    {liste.every((c) => !c.ouvertInscription) && (
                      <p className="mt-2 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        Cette activité n&apos;accepte pas d&apos;inscription pour le moment.
                      </p>
                    )}
                  </div>
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
                        {/* La question qu'on se pose en s'inscrivant : quand
                            est-ce que je commence ? */}
                        {prochaineSeanceDe.has(c.id) && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-600">
                            <CalendarDays className="h-3 w-3 shrink-0" aria-hidden="true" />
                            Prochaine séance : {fmtDateLongue(prochaineSeanceDe.get(c.id)!)}
                          </p>
                        )}
                        {/* Le lieu par créneau seulement quand ils diffèrent :
                            sinon il est déjà en tête de l'activité. Aussi
                            lisible que le jour et l'heure au-dessus — c'est
                            l'information qu'on vient chercher. */}
                        {lieux.length !== 1 && (
                          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-slate-700">
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            {c.lieu ?? "lieu à préciser"}
                            <Itineraire href={itineraireDe(c.lieu, adresses)} />
                          </p>
                        )}
                        {/* L'agent doit savoir avant de s'inscrire si l'activité
                            s'arrête aux vacances : c'est un critère de choix. */}
                        {nbFermetures > 0 && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-slate-600">
                            <CalendarOff className="h-3 w-3 shrink-0" />
                            {c.fermeturesMaintenues.length === 0 ? (
                              /* Gris foncé : en gris clair, la mention était
                                 presque invisible sur un téléphone. */
                              <span>pas de séance pendant les vacances scolaires</span>
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
                          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs tabular-nums text-slate-500">
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {groupe
                                ? `${inscrits} ${pluriel(inscrits, "inscrit")} à ce créneau`
                                : `${inscrits} / ${c.capacite} places`}
                            </span>
                            {/* Le chiffre qui décide, en clair et en couleur ;
                                le compte détaillé reste à gauche pour qui veut
                                le lire. */}
                            {groupe ? (
                              // Sur le créneau où l'on est inscrit, le bandeau
                              // en dessous le dit déjà.
                              activitesAvecPlace.has(activite.id) &&
                              !mienne && (
                                <span className="font-semibold text-brand-600">
                                  votre place vaut pour tous les créneaux
                                </span>
                              )
                            ) : complet ? (
                              <span className="font-semibold text-amber-700">
                                Complet
                                {(attenteParCreneau.get(c.id) ?? 0) > 0
                                  ? ` · ${attenteParCreneau.get(c.id)} en attente`
                                  : ""}
                              </span>
                            ) : (
                              <span className="font-semibold text-brand-600">
                                {c.capacite - inscrits}{" "}
                                {pluriel(c.capacite - inscrits, "place libre", "places libres")}
                              </span>
                            )}
                          </div>
                          {!groupe && (
                            <Jauge
                              valeur={(inscrits / c.capacite) * 100}
                              couleur={complet ? COMPLET : activite.couleur}
                            />
                          )}
                        </div>

                        {mienne?.statut === "VALIDEE" ? (
                          /* Plein, à la taille du bouton qu'il remplace : on
                             voit d'un coup d'œil ce qui est à soi. */
                          <p className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white">
                            <Check className="h-4 w-4" aria-hidden="true" />
                            Vous êtes inscrit
                          </p>
                        ) : mienne ? (
                          <p className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs font-medium text-slate-500">
                            {/* Mêmes mots que le badge de « Mes inscriptions »
                                au-dessus : un même état ne doit pas se lire
                                de deux façons sur un même écran. */}
                            {mienne.statut === "LISTE_ATTENTE"
                              ? `${INSCRIPTION_STATUT_LABELS.LISTE_ATTENTE} n°${mienne.rang}`
                              : INSCRIPTION_STATUT_LABELS.EN_ATTENTE}
                          </p>
                        ) : !c.ouvertInscription ? (
                          /* En rouge, et non en gris comme le quota : un
                             créneau fermé ne se rouvrira pas en se
                             désinscrivant d'un autre. C'est un refus qui vient
                             du service des sports, pas une limite qu'on lève
                             soi-même — l'agent doit s'en apercevoir sans lire. */
                          <>
                            <p className="flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-medium text-red-700">
                              <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                              Inscriptions fermées
                            </p>
                            {/* « Revenez voir plus tard » ne marche pas ; un
                                courriel à l'ouverture, si. */}
                            <AlerteOuverture creneauId={c.id} posee={mesAlertes.has(c.id)} />
                          </>
                        ) : bloqueParQuota ? (
                          /* Le quota expliqué là où il bloque, avec la sortie :
                             un « Quota atteint » grisé laissait l'agent sans
                             savoir quoi faire. */
                          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            {complet
                              ? "Vous attendez déjà sur un autre créneau. "
                              : "Vous avez atteint votre quota d'inscriptions. "}
                            <a href="#mes-inscriptions" className="font-semibold underline underline-offset-2">
                              {complet ? "Quittez cette file" : "Libérez un créneau"}
                            </a>
                            {complet
                              ? " pour rejoindre celle-ci."
                              : filesEpuisees
                                ? " pour en choisir un autre."
                                : " pour en choisir un autre — ou rejoignez la liste d'attente d'un créneau complet."}
                          </p>
                        ) : (
                          <InscrireForm
                            creneauId={c.id}
                            complet={complet}
                            couleur={activite.couleur}
                            intitule={`${activite.nom} · ${JOUR_LABELS[c.jour]} ${c.heureDebut}–${c.heureFin}`}
                            textes={textes}
                            conservationMois={g.conservationMois}
                            // La place est déjà prise sur le groupe : on
                            // n'inscrit pas, on ajoute un horaire.
                            libelle={
                              groupe && activitesAvecPlace.has(activite.id)
                                ? "Ajouter ce créneau"
                                : undefined
                            }
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
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
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
                  <p className="text-xs text-slate-500">{fmtDateLongue(p.seance.date)}</p>
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
