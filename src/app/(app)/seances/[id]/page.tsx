import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, LockOpen, RotateCcw } from "lucide-react";
import { prisma } from "@/lib/db";
import { estGestionnaire, requireUser } from "@/lib/session";
import { feuilleDeSeance } from "@/lib/emargement";
import { cloturerSeance, retablirSeance, rouvrirSeance } from "@/lib/actions/seances";
import { aujourdhui, fmtDateLongue, fmtHorodatage } from "@/lib/dates";
import { Badge, Card, EmptyState, PageHeader, btnSecondary } from "@/components/ui";
import { Panneau } from "@/components/panneau";
import { BoutonAction } from "@/components/bouton-action";
import { FeuilleGestion } from "@/components/feuille-gestion";
import {
  AjouterParticipantForm,
  AnnulerSeanceForm,
  CommentaireForm,
} from "@/components/seance-actions";
import { SEANCE_STATUT_COLORS, SEANCE_STATUT_LABELS } from "@/lib/constants";

export default async function SeanceDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser("GESTIONNAIRE", "COACH");
  const feuille = await feuilleDeSeance(id);
  if (!feuille) notFound();

  const { seance, lignes } = feuille;

  // Un animateur ne consulte que ses propres séances.
  if (!estGestionnaire(user)) {
    const coach = await prisma.coach.findUnique({ where: { userId: user.id } });
    if (!coach || !seance.creneau.animateurs.some((a) => a.id === coach.id)) notFound();
  }

  const gestionnaire = estGestionnaire(user);
  const verrouillee = Boolean(seance.clotureeAt) && !gestionnaire;
  const aVenir = seance.date >= aujourdhui();

  return (
    <>
      <Link
        href="/seances"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Retour au planning
      </Link>

      <PageHeader
        title={seance.creneau.activite.nom}
        subtitle={`${fmtDateLongue(seance.date)} · ${seance.creneau.heureDebut}–${seance.creneau.heureFin}${seance.creneau.lieu ? ` · ${seance.creneau.lieu}` : ""}`}
      >
        <Badge color={SEANCE_STATUT_COLORS[seance.statut]}>
          {SEANCE_STATUT_LABELS[seance.statut]}
        </Badge>
        {seance.statut === "ANNULEE" && gestionnaire && (
          <BoutonAction action={retablirSeance.bind(null, id)} className={btnSecondary}>
            <RotateCcw className="h-4 w-4" /> Rétablir
          </BoutonAction>
        )}
        {seance.clotureeAt ? (
          gestionnaire && (
            <BoutonAction
              action={rouvrirSeance.bind(null, id)}
              className={btnSecondary}
              confirmation="Rouvrir la feuille pour correction ?"
            >
              <LockOpen className="h-4 w-4" /> Rouvrir
            </BoutonAction>
          )
        ) : (
          <BoutonAction
            action={cloturerSeance.bind(null, id)}
            className={btnSecondary}
            confirmation="Clôturer la feuille ? L'animateur ne pourra plus la modifier."
          >
            <Lock className="h-4 w-4" /> Clôturer
          </BoutonAction>
        )}
      </PageHeader>

      {seance.statut === "ANNULEE" && (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">Séance annulée</p>
          {seance.motifAnnulation && <p className="mt-0.5">{seance.motifAnnulation}</p>}
        </div>
      )}

      {seance.clotureeAt && (
        <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          Feuille transmise le {fmtHorodatage(seance.clotureeAt)}
          {seance.clotureePar ? ` par ${seance.clotureePar}` : ""}.
        </div>
      )}

      {lignes.length === 0 ? (
        <Card title="Feuille de présence">
          <EmptyState
            title="Aucun inscrit sur ce créneau"
            hint="Validez des inscriptions pour que la feuille se remplisse."
          />
        </Card>
      ) : (
        <FeuilleGestion
          seanceId={id}
          lignes={lignes}
          verrouillee={verrouillee}
          effectif={feuille.effectif}
          coachNom={
            seance.creneau.animateurs.length > 0
              ? seance.creneau.animateurs.map((c) => `${c.prenom} ${c.nom}`).join(", ")
              : undefined
          }
        />
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panneau titre="Commentaire de séance" sousTitre="Matériel, incident, remarque">
          <CommentaireForm seanceId={id} valeur={seance.commentaire} />
        </Panneau>

        {/* Ouvert aussi aux animateurs : c'est eux qui ont la personne devant
            eux quand elle se présente sans être inscrite. */}
        {!verrouillee && (
          <Panneau
            titre="Ajouter un participant ponctuel"
            sousTitre="Un agent venu sans être inscrit"
          >
            <AjouterParticipantForm seanceId={id} gestionnaire={gestionnaire} />
          </Panneau>
        )}

        {seance.statut !== "ANNULEE" && (
          <Panneau
            titre="Annulation de séance"
            sousTitre={
              aVenir
                ? "Prévenir que la séance n'aura pas lieu"
                : "Déclarer que la séance n'a pas eu lieu"
            }
          >
            <AnnulerSeanceForm seanceId={id} aVenir={aVenir} />
          </Panneau>
        )}
      </div>
    </>
  );
}
