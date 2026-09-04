import { Dumbbell } from "lucide-react";
import { getGeneralSettings } from "@/lib/settings";
import { TitreConnexion, btnPrimary } from "@/components/ui";
import { activerLienAction } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

// Le jeton figure dans l'URL de cette page : aucun en-tête Referer ne doit
// l'emporter ailleurs si l'agent suit un lien depuis ici.
export const metadata = { referrer: "no-referrer" as const };

/**
 * Écran de confirmation du lien de connexion.
 *
 * Le lien reçu par courriel ne se consomme plus en l'ouvrant : il faut cliquer.
 * Ce n'est pas une précaution abstraite. Un jeton à usage unique posé dans une
 * URL est ouvert AVANT son destinataire par tout ce qui inspecte le courrier —
 * antivirus de passerelle, réécriture d'URL type Safe Links, aperçu de la
 * messagerie. L'agent recevait alors « ce lien n'est plus valable » pour un lien
 * qu'il n'avait jamais utilisé, et redemandait un lien qui échouait pareil.
 *
 * Un robot suit les liens, il ne soumet pas les formulaires. Le POST déplace
 * donc la consommation hors de leur portée, et retire au passage le jeton du
 * champ de vision des journaux de proxy et de l'historique du navigateur.
 */
export default async function LienPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const g = await getGeneralSettings();
  const { token } = await searchParams;

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

        <form
          action={activerLienAction}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm"
        >
          <input type="hidden" name="token" value={token ?? ""} />
          <p className="text-sm text-slate-600">
            Vous êtes à un clic de votre espace. Ce lien ne fonctionne
            qu&apos;une fois.
          </p>
          <SubmitButton
            className={`${btnPrimary} w-full justify-center`}
            pendingLabel="Connexion…"
          >
            Me connecter
          </SubmitButton>
        </form>
      </div>
    </main>
  );
}
