"use client";

import { useActionState } from "react";
import { Link2, Mail } from "lucide-react";
import { modifierEmailAgent, rattacherCompteAd } from "@/lib/actions/agents";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, btnSecondary } from "@/components/ui";
import { ChampAgent } from "@/components/champ-agent";
import { SubmitButton } from "@/components/submit-button";

/**
 * Adresse à laquelle joindre l'agent, saisie par le service des sports.
 *
 * Elle s'ajoute à celle de l'annuaire sans l'écraser, et l'emporte sur elle.
 * Deux besoins qu'un seul champ ne couvrait pas : le participant hors annuaire
 * dont l'adresse a été oubliée à la création, et l'agent de terrain qui a bien
 * une boîte professionnelle mais ne l'ouvre jamais — or c'est celui-là que la
 * connexion par lien est censée servir.
 */
export function EmailAgentForm({
  userId,
  emailContact,
  emailAnnuaire,
}: {
  userId: string;
  emailContact: string | null;
  emailAnnuaire: string | null;
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
        label="Adresse de contact"
        hint={
          emailAnnuaire
            ? `Elle commande la connexion par lien, les rappels et les annonces d'annulation, et prime sur l'adresse de l'annuaire (${emailAnnuaire}). Champ vide : c'est celle de l'annuaire qui sert.`
            : "Elle commande la connexion par lien, les rappels de séance et les annonces d'annulation. Une adresse personnelle convient si l'agent n'a pas de boîte professionnelle."
        }
      >
        <Input
          name="email"
          type="email"
          defaultValue={emailContact ?? ""}
          placeholder="c.dupont@exemple.fr"
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
