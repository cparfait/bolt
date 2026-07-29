"use client";

import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { creerAgentHorsAnnuaire } from "@/lib/actions/agents";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, Select, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/**
 * Création d'un participant absent de l'Active Directory.
 *
 * Le formulaire reste volontairement court : c'est une exception administrative,
 * pas une fiche agent. L'adresse e-mail n'est pas obligatoire, mais elle est la
 * seule façon pour la personne de se connecter et d'être prévenue — d'où
 * l'indication plutôt qu'un champ requis qui pousserait à inventer une adresse.
 */
export function AgentHorsAnnuaireForm({
  creneaux,
}: {
  creneaux: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    creerAgentHorsAnnuaire,
    null,
  );
  return (
    <form action={action} className="space-y-4" key={state?.success ?? "initial"}>
      <Alert state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom et prénom" required>
          <Input name="nom" required placeholder="Camille DUPONT" />
        </Field>
        <Field
          label="Adresse e-mail"
          hint="Sans elle, la personne ne peut ni se connecter ni être prévenue d'une annulation."
        >
          <Input name="email" type="email" placeholder="c.dupont@ccas-exemple.fr" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Direction" hint="Reprise dans les statistiques de fréquentation.">
          <Input name="direction" placeholder="CCAS, élus, association…" />
        </Field>
        <Field label="Service">
          <Input name="service" placeholder="facultatif" />
        </Field>
      </div>

      {creneaux.length > 0 && (
        <Field
          label="Inscrire tout de suite à un créneau"
          hint="Facultatif. Créneau complet : la personne est placée en liste d'attente."
        >
          <Select name="creneauId" defaultValue="">
            <option value="">— Ne pas inscrire pour l&apos;instant —</option>
            {creneaux.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <p className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500">
        L&apos;identifiant est attribué automatiquement, préfixé «&nbsp;no_ad.&nbsp;» :
        il ne peut donc pas entrer en conflit si la personne obtient un compte
        Active Directory plus tard. Le compte n&apos;a pas de mot de passe — la
        connexion, si elle est utile, se fait par le lien envoyé sur l&apos;adresse
        renseignée.
      </p>

      <SubmitButton className={btnSecondary} pendingLabel="Création…">
        <UserPlus className="h-4 w-4" /> Créer le participant
      </SubmitButton>
    </form>
  );
}
