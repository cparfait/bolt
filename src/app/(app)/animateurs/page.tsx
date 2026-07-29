import { Ban, KeyRound, Power, ShieldOff, Trash2 } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import {
  basculerAnimateur,
  revoquerLienAnimateur,
  supprimerAnimateur,
} from "@/lib/actions/animateurs";
import { Badge, Card, EmptyState, PageHeader, btnSecondary } from "@/components/ui";
import { Panneau } from "@/components/panneau";
import { BoutonAction } from "@/components/bouton-action";
import { AnimateurForm } from "@/components/animateur-form";
import { LienForm } from "@/components/lien-form";
import { COACH_ACCES_LABELS } from "@/lib/constants";
import { fmtDate, fmtHorodatage } from "@/lib/dates";
import { JOUR_LABELS } from "@/lib/dates";

export default async function AnimateursPage() {
  await requireUser("GESTIONNAIRE");

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
          <AnimateurForm />
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

            return (
              <Card key={c.id} className={c.actif ? "" : "opacity-60"}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {c.prenom} {c.nom}
                      </h3>
                      <Badge
                        color={
                          c.acces === "LIEN"
                            ? "bg-brand-100 text-brand-700 ring-brand-500/20"
                            : "bg-slate-100 text-slate-600 ring-slate-500/20"
                        }
                      >
                        {COACH_ACCES_LABELS[c.acces]}
                      </Badge>
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

                {c.creneaux.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {c.creneaux.map((cr) => (
                      <span
                        key={cr.id}
                        className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: `${cr.activite.couleur}14`,
                          color: cr.activite.couleur,
                        }}
                      >
                        {cr.activite.nom} · {JOUR_LABELS[cr.jour]} {cr.heureDebut}
                      </span>
                    ))}
                  </div>
                )}

                {c.acces === "LIEN" && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
                        <KeyRound className="h-4 w-4 text-slate-400" />
                        Accès distant
                      </p>
                      {lienActif && (
                        <BoutonAction
                          action={revoquerLienAnimateur.bind(null, c.id)}
                          confirmation="Révoquer le lien ? L'animateur ne pourra plus émarger."
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          <ShieldOff className="h-3.5 w-3.5" /> Révoquer
                        </BoutonAction>
                      )}
                    </div>

                    {lienActif ? (
                      <ul className="mb-4 space-y-1 text-xs text-slate-500">
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
                            Code bloqué jusqu&apos;à {fmtHorodatage(c.pinLockedUntil)}
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="mb-4 text-sm text-amber-600">
                        Aucun lien actif — cet animateur ne peut pas encore émarger.
                      </p>
                    )}

                    <LienForm
                      coachId={c.id}
                      avecEmail={Boolean(c.email)}
                      aDejaUnLien={lienActif}
                    />
                  </div>
                )}

                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-brand-600">
                    Modifier la fiche
                  </summary>
                  <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                    <AnimateurForm
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
