import { requireUser } from "@/lib/session";
import { compterAReinitialiser } from "@/lib/reinitialisation";
import { Card } from "@/components/ui";
import { ReinitialisationForm } from "@/components/reinitialisation-form";

export const dynamic = "force-dynamic";

/**
 * Remise à zéro de l'exploitation — administrateurs seuls.
 *
 * Son propre onglet, plutôt qu'un encart au bas d'un écran partagé : la
 * décision demande de lire une page entière, et un bouton de cette portée n'a
 * pas à se trouver sous la main de quelqu'un venu régler autre chose.
 */
export default async function RemiseAZeroPage() {
  await requireUser("ADMIN");
  const decompte = await compterAReinitialiser();

  return (
    <Card title="Remise à zéro des données">
      <p className="mb-4 text-sm text-slate-500">
        Repartir d&apos;une application vierge en gardant le paramétrage : la
        configuration de l&apos;annuaire, de la messagerie et le référentiel des
        services survivent, tout le reste s&apos;efface.
      </p>
      <ReinitialisationForm decompte={decompte} />
    </Card>
  );
}
