import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { prisma } from "@/lib/db";
import { desinscriptionAutorisee } from "@/lib/liens-courriel";
import { JOUR_LABELS, fmtHeure } from "@/lib/dates";
import { nomPourSalutation } from "@/lib/constants";
import { CadreCourriel } from "@/app/courriel/cadre";
import { Itineraire } from "@/components/itineraire";
import { lienItineraireDuLieu } from "@/lib/lieux";
import { BoutonDesinscription } from "./bouton";

export const dynamic = "force-dynamic";

/**
 * « Je libère ma place » — page ouverte depuis le courriel envoyé après des
 * absences répétées (src/lib/avis-absences.ts).
 *
 * L'agent qui ne vient plus est précisément celui qui n'ouvrira pas
 * l'application pour se désinscrire : il a décroché, et son mot de passe avec.
 * Le courriel lui tend le geste ; cette page le fait, en deux clics, sans
 * session — la signature du lien vaut pour lui, pour cette inscription, et
 * pour le cycle d'inscription en cours seulement.
 *
 * Comme pour les autres liens, rien ne se passe à l'ouverture : les
 * passerelles de messagerie visitent les adresses avant de remettre le message,
 * et une place se libère sans retour possible.
 */
export default async function DesinscriptionPage({
  params,
}: {
  params: Promise<{ inscriptionId: string; signature: string }>;
}) {
  const { inscriptionId, signature } = await params;

  // L'inscription d'abord, la signature ensuite : elle se vérifie contre
  // l'état actuel de l'inscription (le début de son cycle), pas contre ce que
  // porte l'adresse. Inconnue ou lien périmé : même 404, rien à distinguer.
  const inscription = await prisma.inscription.findUnique({
    where: { id: inscriptionId },
    include: {
      user: { select: { displayName: true } },
      creneau: { include: { activite: true } },
    },
  });
  if (!inscription || !desinscriptionAutorisee(inscription, signature)) notFound();

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

      {/* Rendu même quand il n'y a plus de place à libérer, et c'est lui qui
          le dit : une action serveur fait rejouer cette page, et le sortir de
          l'arbre effacerait le compte rendu du geste dans la seconde. */}
      <BoutonDesinscription
        inscriptionId={inscriptionId}
        signature={signature}
        activite={creneau.activite.nom}
        occupee={inscription.statut === "VALIDEE"}
      />
    </CadreCourriel>
  );
}
