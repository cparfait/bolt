import { notFound } from "next/navigation";
import { CalendarOff, MapPin } from "lucide-react";
import { prisma } from "@/lib/db";
import { absenceAutorisee } from "@/lib/liens-courriel";
import { aujourdhui, fmtDateLongue, fmtHeure } from "@/lib/dates";
import { nomPourSalutation } from "@/lib/constants";
import { CadreCourriel } from "@/app/courriel/cadre";
import { Itineraire } from "@/components/itineraire";
import { lienItineraireDuLieu } from "@/lib/lieux";
import { BoutonAbsence } from "./bouton";

export const dynamic = "force-dynamic";

/**
 * « Je ne pourrai pas venir » — page ouverte depuis le courriel de rappel.
 *
 * Elle n'agit pas à l'ouverture : les passerelles de sécurité des messageries
 * visitent toutes les adresses d'un message avant de le remettre, et un lien
 * qui déclarerait l'absence en GET rendrait absent tout le monde. La page
 * montre donc de quelle séance il s'agit, et attend un clic.
 *
 * Elle est joignable depuis Internet (voir src/proxy.ts) : c'est là que le
 * rappel se lit. Elle ne révèle qu'une séance et un prénom, et seulement à qui
 * détient un lien signé pour ce couple agent/séance.
 */
export default async function AbsencePage({
  params,
}: {
  params: Promise<{ seanceId: string; userId: string; signature: string }>;
}) {
  const { seanceId, userId, signature } = await params;
  // Signature invalide : un 404, et non un message d'erreur. Distinguer « lien
  // abîmé » de « séance inconnue » apprendrait à qui essaie des adresses
  // lesquelles désignent quelque chose.
  if (!absenceAutorisee(seanceId, userId, signature)) notFound();

  const [seance, agent] = await Promise.all([
    prisma.seance.findUnique({
      where: { id: seanceId },
      include: { creneau: { include: { activite: true } } },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
  ]);
  if (!seance || !agent) notFound();
  const itineraire = await lienItineraireDuLieu(seance.creneau.lieu);

  const [inscrit, absence] = await Promise.all([
    prisma.inscription.findFirst({
      where: { creneauId: seance.creneauId, userId, statut: "VALIDEE" },
      select: { id: true },
    }),
    prisma.absenceAnnoncee.findUnique({
      where: { seanceId_userId: { seanceId, userId } },
      select: { id: true },
    }),
  ]);

  // Ce qui empêche encore de déclarer. Le message dit quoi faire à la place :
  // « ce lien ne marche plus » laisserait l'agent sans recours, alors qu'il a
  // précisément ouvert son courriel pour prévenir quelqu'un.
  const obstacle =
    seance.statut === "ANNULEE"
      ? "Cette séance est annulée : il n'y a rien à signaler."
      : seance.clotureeAt
        ? "La feuille de cette séance a déjà été transmise par l'animateur."
        : seance.date < aujourdhui()
          ? "Cette séance est passée. Pour la prochaine, vous recevrez un nouveau rappel."
          : !inscrit
            ? "Vous n'êtes plus inscrit à ce créneau."
            : null;

  return (
    <CadreCourriel>
      <p className="text-sm text-slate-500">
        Bonjour {nomPourSalutation(agent.displayName)},
      </p>
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
        <p
          className="text-base font-semibold"
          style={{ color: seance.creneau.activite.couleur }}
        >
          {seance.creneau.activite.nom}
        </p>
        <p className="mt-0.5 text-sm text-slate-600">
          {fmtDateLongue(seance.date)} · {fmtHeure(seance.creneau.heureDebut)}–
          {fmtHeure(seance.creneau.heureFin)}
        </p>
        {seance.creneau.lieu && (
          <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-700">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {seance.creneau.lieu}
            {itineraire && (
              <>
                {" · "}
                <Itineraire href={itineraire} />
              </>
            )}
          </p>
        )}
      </div>

      {obstacle ? (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
          <CalendarOff className="mt-0.5 h-4 w-4 shrink-0" />
          {obstacle}
        </p>
      ) : (
        <BoutonAbsence
          seanceId={seanceId}
          userId={userId}
          signature={signature}
          absentAuDepart={absence !== null}
        />
      )}
    </CadreCourriel>
  );
}
