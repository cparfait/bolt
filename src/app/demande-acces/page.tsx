import { Dumbbell, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getGeneralSettings } from "@/lib/settings";
import { TitreConnexion } from "@/components/ui";
import { DemandeAccesForm } from "./formulaire";

export const dynamic = "force-dynamic";

/**
 * Demande d'accès pour les personnes absentes de l'annuaire.
 *
 * Cette page est publiée sur Internet, et c'est la seule de l'application qui
 * accepte une identité que Bolt ne connaît pas encore. Elle ne délivre donc
 * rien : ni compte, ni session, ni courriel vers l'adresse saisie. Le formulaire
 * dépose une ligne dans une file que le service des sports arbitre. Voir
 * `src/lib/demandes.ts` pour le raisonnement complet.
 */
export default async function DemandeAccesPage() {
  const g = await getGeneralSettings();
  // Désactivé, l'écran n'existe pas : mieux vaut un 404 qu'une page qui
  // explique comment demander un accès dont personne ne verra la demande.
  if (!g.demandeAccesActive) notFound();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          {g.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URI, next/image ne s'applique pas
            <img
              src={g.logo}
              alt={g.orgName}
              className="max-h-20 w-auto max-w-[280px] object-contain"
            />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/20">
              <Dumbbell className="h-6 w-6" />
            </span>
          )}
          <TitreConnexion
            logo={g.logo}
            orgName={g.orgName}
            appName={g.appName}
            appDescription={g.appDescription}
          />
        </div>

        <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
          <p className="text-sm font-semibold text-slate-700">
            Demander un accès aux activités
          </p>
          <p className="mt-1 text-sm text-slate-500">
            À remplir si vous n&apos;avez pas de compte informatique de la
            collectivité — vacataire, contrat court, agent d&apos;un autre
            organisme. Si vous en avez un,{" "}
            <Link href="/acces" className="font-medium text-brand-600 hover:underline">
              connectez-vous directement
            </Link>
            .
          </p>
        </div>

        <DemandeAccesForm />

        <p className="mt-6 flex items-start gap-2 text-xs text-slate-400">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Vos coordonnées ne servent qu&apos;à traiter cette demande et à gérer
          votre participation aux activités.
          {g.contactEmail ? ` Une question : ${g.contactEmail}.` : ""}
        </p>
      </div>
    </main>
  );
}
