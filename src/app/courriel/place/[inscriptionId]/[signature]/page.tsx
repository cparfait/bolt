import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { prisma } from "@/lib/db";
import { placeAutorisee } from "@/lib/liens-courriel";
import { JOUR_LABELS, fmtHeure } from "@/lib/dates";
import { nomPourSalutation } from "@/lib/constants";
import { CadreCourriel } from "@/app/courriel/cadre";
import { Itineraire } from "@/components/itineraire";
import { lienItineraireDuLieu } from "@/lib/lieux";
import { BoutonPlace } from "./bouton";

export const dynamic = "force-dynamic";

/**
 * « Je laisse ma place » — page ouverte depuis le courriel de promotion.
 *
 * Une promotion depuis la liste d'attente arrive sans avoir été demandée,
 * parfois des mois après l'inscription : entre-temps l'agent a changé
 * d'horaires, s'est blessé, ou ne veut simplement plus. Sans ce bouton, la
 * place restait occupée par quelqu'un qui ne viendrait pas pendant que le
 * suivant de la file attendait toujours — et le service des sports ne
 * l'apprenait qu'au bout de trois absences.
 *
 * Comme pour l'absence, rien ne se passe à l'ouverture du lien : les
 * passerelles de messagerie visitent les adresses avant de remettre le message,
 * et une place se rend sans retour possible.
 */
export default async function PlacePage({
  params,
}: {
  params: Promise<{ inscriptionId: string; signature: string }>;
}) {
  const { inscriptionId, signature } = await params;
  if (!placeAutorisee(inscriptionId, signature)) notFound();

  const inscription = await prisma.inscription.findUnique({
    where: { id: inscriptionId },
    include: {
      user: { select: { displayName: true } },
      creneau: { include: { activite: true } },
    },
  });
  if (!inscription) notFound();

  const { creneau } = inscription;
  const itineraire = await lienItineraireDuLieu(creneau.lieu);

  return (
    <CadreCourriel>
      <p className="text-sm text-slate-500">
        Bonjour {nomPourSalutation(inscription.user.displayName)},
      </p>
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
        <p className="text-base font-semibold" style={{ color: creneau.activite.couleur }}>
          {creneau.activite.nom}
        </p>
        <p className="mt-0.5 text-sm text-slate-600">
          {JOUR_LABELS[creneau.jour]} · {fmtHeure(creneau.heureDebut)}–
          {fmtHeure(creneau.heureFin)}
        </p>
        {creneau.lieu && (
          <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-700">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {creneau.lieu}
            {itineraire && (
              <>
                {" "}
                <Itineraire href={itineraire} />
              </>
            )}
          </p>
        )}
      </div>

      {/* Le composant client est rendu même quand il n'y a plus de place à
          rendre, et c'est lui qui le dit. Une action serveur fait rejouer cette
          page : le sortir de l'arbre effacerait, dans la seconde qui suit le
          clic, le compte rendu de ce qui vient d'être fait — remplacé par un
          « vous n'occupez plus de place » qui se lit comme un échec. */}
      <BoutonPlace
        inscriptionId={inscriptionId}
        signature={signature}
        activite={creneau.activite.nom}
        occupee={inscription.statut === "VALIDEE"}
      />
    </CadreCourriel>
  );
}
