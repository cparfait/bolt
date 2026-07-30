import { Dumbbell, Mail } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/session";
import { getGeneralSettings } from "@/lib/settings";
import { TitreConnexion } from "@/components/ui";
import { DemandeLienForm } from "./demande-form";

/**
 * Entrée publique pour les agents sans poste sur le réseau : on ne leur demande
 * que leur adresse professionnelle, jamais leur mot de passe de domaine.
 */
export default async function AccesPage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string }>;
}) {
  const user = await currentUser();
  if (user) redirect("/mes-activites");
  const g = await getGeneralSettings();
  // `/acces/lien` renvoie ici quand le jeton est inconnu, déjà consommé ou
  // périmé. Sans ce message, l'agent retombait sur le formulaire sans un mot
  // d'explication : il concluait que « le lien ne marche pas », et redemandait
  // un lien qui échouerait pour la même raison.
  const { erreur } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm">
        {/* Même en-tête que /connexion : c'est la même porte d'entrée, vue par
            un agent qui n'a pas de poste sur le réseau. */}
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
          <TitreConnexion logo={g.logo} orgName={g.orgName} />
        </div>

        {erreur === "lien" && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5">
            <p className="text-sm font-semibold text-amber-800">
              Ce lien n&apos;est plus valable
            </p>
            <p className="mt-1 text-sm text-amber-700">
              Un lien ne fonctionne qu&apos;une fois, et pendant 30 minutes.
              Demandez-en un nouveau ci-dessous : le précédent a peut-être déjà
              servi, ou été ouvert par votre messagerie avant vous.
            </p>
          </div>
        )}

        {g.lienMagiqueActif ? (
          <>
            <DemandeLienForm />
            <p className="mt-6 flex items-start gap-2 text-xs text-slate-400">
              <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Nous envoyons un lien de connexion à l&apos;adresse enregistrée pour
              vous par le service des sports. Aucun mot de passe n&apos;est
              demandé.
            </p>
          </>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm text-slate-600">
              La connexion par e-mail n&apos;est pas activée.
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Connectez-vous depuis un poste de la collectivité avec votre
              identifiant Windows.
            </p>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-slate-400">
          Vous êtes sur un poste du réseau ?{" "}
          <Link href="/connexion" className="font-medium text-brand-600 hover:underline">
            Connexion habituelle
          </Link>
        </p>
      </div>
    </main>
  );
}
