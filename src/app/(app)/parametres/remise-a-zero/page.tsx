import { requireUser } from "@/lib/session";
import { compterAReinitialiser } from "@/lib/reinitialisation";
import { donneesDejaPresentes } from "@/lib/jeu-de-test";
import { Card } from "@/components/ui";
import { ReinitialisationForm } from "@/components/reinitialisation-form";
import { JeuDeTestForm } from "@/components/jeu-de-test-form";

export const dynamic = "force-dynamic";

/**
 * Remise à zéro de l'exploitation, et jeu de test — administrateurs seuls.
 *
 * Son propre onglet, plutôt qu'un encart au bas d'un écran partagé : la
 * décision demande de lire une page entière, et un bouton de cette portée n'a
 * pas à se trouver sous la main de quelqu'un venu régler autre chose.
 *
 * Les deux cartes vont ensemble et dans cet ordre : vider, puis remplir de
 * faux. C'est l'enchaînement d'une recette — on repart de zéro, on charge de
 * quoi essayer, on efface avant la mise en service. Le jeu de test refuse
 * d'ailleurs de s'installer tant que la première n'a pas été passée.
 */
export default async function RemiseAZeroPage() {
  await requireUser("ADMIN");
  const [decompte, exploitation] = await Promise.all([
    compterAReinitialiser(),
    donneesDejaPresentes(),
  ]);

  return (
    <div className="space-y-6">
      <Card title="Remise à zéro des données">
        <p className="mb-4 text-sm text-slate-500">
          Repartir d&apos;une application vierge en gardant le paramétrage : la
          configuration de l&apos;annuaire, de la messagerie et le référentiel des
          services survivent, tout le reste s&apos;efface.
        </p>
        <ReinitialisationForm decompte={decompte} />
      </Card>

      <Card title="Jeu de test">
        <p className="mb-4 text-sm text-slate-500">
          Une collectivité fictive mais complète — une saison, des activités, des
          agents et un historique de fréquentation — pour essayer les écrans qui
          n&apos;ont rien à montrer sur une base vide : tableau de bord,
          statistiques, feuilles à rattraper, listes d&apos;attente.
        </p>
        <JeuDeTestForm vide={exploitation === 0} />
      </Card>
    </div>
  );
}
