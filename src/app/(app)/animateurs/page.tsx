import { Ban, KeyRound, Power, ShieldOff, Trash2 } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import {
  basculerAnimateur,
  revoquerLienAnimateur,
  supprimerAnimateur,
} from "@/lib/actions/animateurs";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  PastilleActivite,
  btnSecondary,
} from "@/components/ui";
import { Panneau } from "@/components/panneau";
import { BoutonAction } from "@/components/bouton-action";
import { AnimateurForm } from "@/components/animateur-form";
import { LienForm } from "@/components/lien-form";
import { COACH_ACCES_LABELS } from "@/lib/constants";
import { fmtDate, fmtHorodatage, isoDate } from "@/lib/dates";
import { JOUR_LABELS } from "@/lib/dates";
import { saisonCourante } from "@/lib/saison";

/**
 * Créneaux regroupés par activité, l'ordre jour/heure de la requête conservé.
 *
 * Un animateur tient souvent la même activité à plusieurs horaires. Une file de
 * pastilles « activité · jour · heure » répétait alors le nom de l'activité
 * autant de fois qu'elle avait de créneaux, et il fallait parcourir toute la
 * ligne pour répondre aussi bien à « qu'anime cette personne ? » qu'à « quand
 * vient-elle ? ». Groupée, l'activité se nomme une fois et porte ses horaires.
 */
function grouperParActivite<
  T extends { activiteId: string; activite: { nom: string; couleur: string } },
>(creneaux: T[]) {
  const groupes = new Map<
    string,
    { activiteId: string; nom: string; couleur: string; creneaux: T[] }
  >();

  for (const cr of creneaux) {
    const groupe = groupes.get(cr.activiteId);
    if (groupe) groupe.creneaux.push(cr);
    else
      groupes.set(cr.activiteId, {
        activiteId: cr.activiteId,
        nom: cr.activite.nom,
        couleur: cr.activite.couleur,
        creneaux: [cr],
      });
  }

  return [...groupes.values()];
}

export default async function AnimateursPage() {
  const utilisateur = await requireUser("GESTIONNAIRE");
  const estAdmin = utilisateur.role === "ADMIN";

  // Échéance proposée pour les liens d'émargement. Une saison déjà terminée ne
  // sert à rien comme date par défaut : l'action refuserait une date passée.
  const saison = await saisonCourante();
  const finSaison =
    saison && saison.fin > new Date() ? isoDate(saison.fin) : undefined;

  const animateurs = await prisma.coach.findMany({
    orderBy: [{ actif: "desc" }, { nom: "asc" }],
    include: {
      user: { select: { login: true, active: true } },
      creneaux: {
        include: { activite: { select: { nom: true, couleur: true } } },
        orderBy: [{ jour: "asc" }, { heureDebut: "asc" }],
      },
    },
  });

  return (
    <>
      <PageHeader
        title="Animateurs"
        subtitle="Éducateurs et coachs — trois modes d'accès selon leur situation"
      />

      <div className="mb-6">
        <Panneau titre="Ajouter un animateur" sousTitre="Interne ou prestataire extérieur">
          <AnimateurForm estAdmin={estAdmin} />
        </Panneau>
      </div>

      {animateurs.length === 0 ? (
        <EmptyState
          title="Aucun animateur"
          hint="Créez les animateurs, puis rattachez-les à leurs créneaux."
        />
      ) : (
        <div className="space-y-4">
          {animateurs.map((c) => {
            const lienActif = Boolean(c.token);
            const expire = c.tokenExpiresAt && c.tokenExpiresAt < new Date();
            const verrouille = c.pinLockedUntil && c.pinLockedUntil > new Date();

            // Résumé porté par le repli de l'accès distant : replié quand tout
            // va bien, il doit malgré tout dire l'essentiel sans être ouvert.
            const etatLien = verrouille
              ? {
                  texte: `code bloqué jusqu'à ${fmtHorodatage(c.pinLockedUntil)}`,
                  ton: "text-red-600",
                }
              : !lienActif
                ? {
                    texte: "aucun lien — cet animateur ne peut pas émarger",
                    ton: "text-amber-600",
                  }
                : expire
                  ? {
                      texte: `lien expiré le ${fmtDate(c.tokenExpiresAt)}`,
                      ton: "text-amber-600",
                    }
                  : {
                      texte: c.lastAccessAt
                        ? `actif · dernier accès ${fmtHorodatage(c.lastAccessAt)}`
                        : "actif · jamais utilisé",
                      ton: "text-slate-500",
                    };

            // Un accès en règle n'a rien à demander : le pavé reste replié. Il
            // s'ouvre de lui-même dès qu'il y a quelque chose à faire.
            const accesAttentionRequise = Boolean(
              !lienActif || expire || verrouille,
            );

            return (
              <Card key={c.id} className={c.actif ? "" : "opacity-60"}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {c.prenom} {c.nom}
                      </h3>
                      {/* Le lien sécurisé est le cas ordinaire — le signaler
                          sur chaque fiche n'apprend rien. Restent badgés les
                          deux modes qui, eux, sortent de l'ordinaire : un
                          compte du domaine ou un identifiant local. */}
                      {c.acces !== "LIEN" && (
                        <Badge>{COACH_ACCES_LABELS[c.acces]}</Badge>
                      )}
                      {!c.actif && <Badge>Désactivé</Badge>}
                      {verrouille && (
                        <Badge color="bg-red-100 text-red-700 ring-red-500/20">
                          Code bloqué
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {[c.organisme, c.email, c.telephone].filter(Boolean).join(" · ") ||
                        "—"}
                    </p>
                    {c.user && (
                      <p className="text-xs text-slate-400">
                        Compte : {c.user.login}
                        {!c.user.active && " (désactivé)"}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <BoutonAction
                      action={basculerAnimateur.bind(null, c.id)}
                      className={btnSecondary}
                      confirmation={
                        c.actif
                          ? `Désactiver ${c.prenom} ${c.nom} ? Son accès est coupé immédiatement.`
                          : undefined
                      }
                    >
                      <Power className="h-4 w-4" />
                      {c.actif ? "Désactiver" : "Réactiver"}
                    </BoutonAction>
                    {c.creneaux.length === 0 && (
                      <BoutonAction
                        action={supprimerAnimateur.bind(null, c.id)}
                        confirmation={`Supprimer définitivement ${c.prenom} ${c.nom} ?`}
                        className={btnSecondary}
                      >
                        <Trash2 className="h-4 w-4" />
                      </BoutonAction>
                    )}
                  </div>
                </div>

                {c.creneaux.length > 0 ? (
                  <ul className="mt-4 space-y-1.5">
                    {grouperParActivite(c.creneaux).map((g) => (
                      <li
                        key={g.activiteId}
                        className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
                      >
                        <PastilleActivite couleur={g.couleur} nom={g.nom} />
                        <span className="text-sm tabular-nums text-slate-600">
                          {g.creneaux
                            .map(
                              (cr) =>
                                `${JOUR_LABELS[cr.jour]} ${cr.heureDebut}–${cr.heureFin}`,
                            )
                            .join("  ·  ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-slate-400">
                    Aucun créneau rattaché.
                  </p>
                )}

                {c.acces === "LIEN" && (
                  <details open={accesAttentionRequise} className="mt-4">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <KeyRound className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="font-medium text-slate-700">
                        Accès distant
                      </span>
                      <span className={etatLien.ton}>{etatLien.texte}</span>
                    </summary>

                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                      {lienActif && (
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                          {/* Le résumé du repli porte déjà l'état ; ne restent
                              ici que les traces d'usage, utiles au dépannage. */}
                          <ul className="space-y-1 text-xs text-slate-500">
                            <li>
                              Créé le {fmtHorodatage(c.tokenCreatedAt)}
                              {c.tokenExpiresAt &&
                                ` · ${expire ? "expiré" : "expire"} le ${fmtDate(c.tokenExpiresAt)}`}
                            </li>
                            <li>
                              {c.lastAccessAt
                                ? `Dernier accès : ${fmtHorodatage(c.lastAccessAt)}${c.lastAccessIp ? ` depuis ${c.lastAccessIp}` : ""}`
                                : "Jamais utilisé"}
                            </li>
                            {verrouille && (
                              <li className="flex items-center gap-1.5 text-red-600">
                                <Ban className="h-3.5 w-3.5" />
                                Code bloqué jusqu&apos;à{" "}
                                {fmtHorodatage(c.pinLockedUntil)}
                              </li>
                            )}
                          </ul>
                          <BoutonAction
                            action={revoquerLienAnimateur.bind(null, c.id)}
                            confirmation="Révoquer le lien ? L'animateur ne pourra plus émarger."
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                          >
                            <ShieldOff className="h-3.5 w-3.5" /> Révoquer
                          </BoutonAction>
                        </div>
                      )}

                      <LienForm
                        coachId={c.id}
                        avecEmail={Boolean(c.email)}
                        aDejaUnLien={lienActif}
                        finSaison={finSaison}
                      />
                    </div>
                  </details>
                )}

                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-brand-600">
                    Modifier la fiche
                  </summary>
                  <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                    <AnimateurForm
                      estAdmin={estAdmin}
                      initial={{
                        id: c.id,
                        nom: c.nom,
                        prenom: c.prenom,
                        email: c.email,
                        telephone: c.telephone,
                        organisme: c.organisme,
                        acces: c.acces,
                        notes: c.notes,
                        login: c.user?.login ?? null,
                      }}
                    />
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
