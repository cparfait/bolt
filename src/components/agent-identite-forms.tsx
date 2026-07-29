"use client";

import { useActionState } from "react";
import { Link2, Mail } from "lucide-react";
import { modifierEmailAgent, rattacherCompteAd } from "@/lib/actions/agents";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, btnSecondary } from "@/components/ui";
import { ChampAgent } from "@/components/champ-agent";
import { SubmitButton } from "@/components/submit-button";

/**
 * Correction de l'adresse d'un participant hors annuaire.
 *
 * Sans elle, une adresse oubliée ou erronée à la création condamnait la
 * personne au silence — ni lien de connexion, ni rappel, ni annonce
 * d'annulation — et la seule issue était de la recréer, en perdant son
 * historique au passage.
 */
export function EmailAgentForm({
  userId,
  email,
}: {
  userId: string;
  email: string | null;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    modifierEmailAgent,
    null,
  );

  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <input type="hidden" name="userId" value={userId} />
      <Field
        label="Adresse e-mail"
        hint="Elle commande la connexion par lien, les rappels de séance et les annonces d'annulation. Laissez le champ vide pour la retirer."
      >
        <Input
          name="email"
          type="email"
          defaultValue={email ?? ""}
          placeholder="c.dupont@ccas-exemple.fr"
        />
      </Field>
      <SubmitButton className={btnSecondary} pendingLabel="Enregistrement…">
        <Mail className="h-4 w-4" /> Enregistrer l&apos;adresse
      </SubmitButton>
    </form>
  );
}

/**
 * Rattachement à l'Active Directory, une fois le compte de la personne créé.
 *
 * Le cas est fréquent : l'apprenti titularisé, le stagiaire dont le compte
 * arrive trois semaines après lui. Sans ce geste, il repart de zéro sous un
 * nouvel identifiant et son assiduité se retrouve coupée en deux.
 */
export function RattacherAdForm({ userId }: { userId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(
    rattacherCompteAd,
    null,
  );

  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <input type="hidden" name="userId" value={userId} />
      <ChampAgent
        label="Compte Active Directory"
        source="ad"
        hint="Cherchez la personne par son nom ou son identifiant Windows. Ses inscriptions, ses présences et ses absences suivront sur ce compte."
      />
      <SubmitButton className={btnSecondary} pendingLabel="Rattachement…">
        <Link2 className="h-4 w-4" /> Rattacher au compte
      </SubmitButton>
      <p className="text-xs text-slate-400">
        Si l&apos;agent a déjà un compte Bolt, les deux fiches sont fusionnées et
        vous arrivez sur celle qui subsiste. L&apos;opération ne se défait pas.
      </p>
    </form>
  );
}
