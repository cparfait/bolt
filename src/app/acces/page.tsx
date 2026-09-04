import { Dumbbell } from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/session";
import { getGeneralSettings } from "@/lib/settings";
import { clientIp, estInterne } from "@/lib/net";
import { TitreConnexion } from "@/components/ui";
import { DemandeLienForm } from "./demande-form";

export const dynamic = "force-dynamic";

/**
 * Entrée de l'espace agent : une adresse e-mail, un lien reçu, rien d'autre.
 * Jamais de mot de passe de domaine — c'est ce qui permet de publier cette page
 * sur Internet quand `/connexion` ne l'est jamais.
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

  // Depuis Internet, `/connexion` n'est pas publiée : proposer « l'identifiant
  // Windows » y offrirait un lien mort, et surtout ferait chercher un mot de
  // passe là où il n'en faut pas. La proposition n'a de sens que sur le réseau.
  const interne = estInterne(clientIp(await headers()));

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

        {erreur === "lien" && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5">
            <p className="text-sm font-semibold text-amber-800">
              Ce lien a expiré
            </p>
            <p className="mt-1 text-sm text-amber-700">
              Un lien ne sert qu&apos;une fois, et pendant 30 minutes.
              Demandez-en un nouveau ci-dessous.
            </p>
          </div>
        )}

        {g.lienMagiqueActif ? (
          <DemandeLienForm />
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

        {/* Mention affichée en PERMANENCE, jamais en réponse à une adresse
            inconnue. `envoyerLienConnexion` renvoie volontairement le même
            message que l'adresse soit connue ou non : cette page est publiée sur
            Internet, et un « adresse inconnue, contactez le service » en ferait
            un moyen de vérifier qui travaille dans la collectivité. */}
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
          <p className="text-sm font-medium text-slate-700">
            Vous ne recevez rien ?
          </p>
          <p className="mt-1 text-sm text-slate-500">
            C&apos;est que cette adresse n&apos;est pas celle enregistrée pour
            vous — ou que vous n&apos;avez pas encore d&apos;accès. Dans les deux
            cas, le service des sports s&apos;en occupe
            {g.contactEmail ? (
              <>
                {" : "}
                <a
                  href={`mailto:${g.contactEmail}`}
                  className="font-medium text-brand-600 hover:underline"
                >
                  {g.contactEmail}
                </a>
              </>
            ) : (
              ""
            )}
            .
          </p>
          {/* Le lien vers le formulaire n'apparaît que si aucun code de campagne
              n'est exigé : l'afficher avec le code reviendrait à publier ce code
              sur la page même qu'il sert à protéger. */}
          {g.demandeAccesActive && !g.demandeAccesCode ? (
            <p className="mt-2 text-sm text-slate-500">
              Vous n&apos;êtes pas agent de la collectivité ?{" "}
              <Link
                href="/demande-acces"
                className="font-medium text-brand-600 hover:underline"
              >
                Demandez un accès
              </Link>
              .
            </p>
          ) : null}
        </div>

        {interne && (
          <p className="mt-6 text-center text-xs text-slate-400">
            Depuis un poste de la collectivité, vous pouvez aussi utiliser{" "}
            <Link
              href="/connexion"
              className="font-medium text-brand-600 hover:underline"
            >
              votre identifiant Windows
            </Link>
            .
          </p>
        )}
      </div>
    </main>
  );
}
