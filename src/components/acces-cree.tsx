"use client";

import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, Mail } from "lucide-react";
import { envoyerAccesAnimateur, type AccesCree } from "@/lib/actions/animateurs";
import type { ActionState } from "@/lib/actions/types";
import { btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ValeurCopiable } from "@/components/lien-form";

/**
 * L'accès d'un animateur qui vient d'être créé, affiché sur SA fiche.
 *
 * Le code n'existe en clair que dans la réponse de l'action de création,
 * reçue par le formulaire en haut de page. Or c'est sur la fiche de
 * l'animateur, en bas, qu'on s'attend à le lire : un lien et un code posés
 * au-dessus de la liste, loin du nom qu'ils concernent, se lisaient comme
 * un bloc orphelin. Le formulaire dépose donc l'accès dans ce contexte, et la
 * fiche dont l'identifiant correspond l'affiche. L'état vit côté client : la
 * liste se recharge côté serveur après la création, lui reste.
 */
type Contexte = {
  acces: AccesCree | null;
  deposer: (acces: AccesCree | null) => void;
};

const AccesCreeContexte = createContext<Contexte>({ acces: null, deposer: () => {} });

export function AccesCreeProvider({ children }: { children: ReactNode }) {
  const [acces, deposer] = useState<AccesCree | null>(null);
  return (
    <AccesCreeContexte.Provider value={{ acces, deposer }}>{children}</AccesCreeContexte.Provider>
  );
}

export function useAccesCree(): Contexte {
  return useContext(AccesCreeContexte);
}

/** Sur la fiche : le bloc à transmettre, si l'accès créé est celui de cet animateur. */
export function AccesATransmettre({ coachId }: { coachId: string }) {
  const { acces } = useAccesCree();
  if (!acces || acces.coachId !== coachId) return null;
  return <AccesCreeBloc acces={acces} />;
}

/**
 * Le lien et le code s'affichent quoi qu'il arrive — le code est stocké haché,
 * c'est la seule occasion de le lire — et l'envoi par e-mail est proposé, pas
 * fait d'office : c'est une décision à part, et l'adresse de la fiche peut
 * être celle d'un secrétariat.
 */
function AccesCreeBloc({ acces }: { acces: AccesCree }) {
  const [envoi, envoyer] = useActionState<ActionState, FormData>(envoyerAccesAnimateur, null);

  // La fiche peut être loin sous le formulaire : on y amène le regard.
  useEffect(() => {
    document
      .getElementById(`animateur-${acces.coachId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [acces.coachId]);

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
        Accès créé — à transmettre à {acces.nom}
      </p>

      <ValeurCopiable etiquette="Lien" valeur={acces.lien} />
      <ValeurCopiable etiquette="Code à 6 chiffres" valeur={acces.pin} large />

      <p className="text-xs text-emerald-800">
        Notez le code maintenant : il est stocké chiffré et ne pourra plus être
        réaffiché, seulement régénéré depuis « Accès distant » ci-dessous.
        {acces.expiration
          ? ` L'accès est valable jusqu'au ${acces.expiration}, fin de la saison.`
          : " L'accès n'a pas d'échéance."}
      </p>

      {envoi?.success ? (
        <p className="flex items-start gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-emerald-800">
          <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{envoi.success}</span>
        </p>
      ) : acces.email ? (
        <form action={envoyer} className="space-y-2">
          <input type="hidden" name="id" value={acces.coachId} />
          <input type="hidden" name="pin" value={acces.pin} />
          {envoi?.error && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{envoi.error}</span>
            </p>
          )}
          <SubmitButton className={btnSecondary} pendingLabel="Envoi…">
            <Mail className="h-4 w-4" /> Envoyer par e-mail à {acces.email}
          </SubmitButton>
        </form>
      ) : (
        <p className="text-xs text-slate-600">
          Aucune adresse e-mail sur la fiche : transmettez le lien et le code par
          un autre moyen.
        </p>
      )}
    </div>
  );
}
