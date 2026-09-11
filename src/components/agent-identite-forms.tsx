"use client";

import { useActionState } from "react";
import { Building2, Link2, Mail } from "lucide-react";
import {
  modifierEmailAgent,
  modifierServiceAgent,
  rattacherCompteAd,
} from "@/lib/actions/agents";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, Select, btnSecondary } from "@/components/ui";
import { ChampAgent } from "@/components/champ-agent";
import { SubmitButton } from "@/components/submit-button";

/**
 * Adresse à laquelle joindre un participant hors annuaire, saisie par le service
 * des sports. Le cas visé : le participant créé à la volée depuis une feuille
 * d'émargement, dont l'adresse a été oubliée — élu, stagiaire, invité d'un
 * organisme partenaire. Sans ce champ, Bolt ne peut rien lui envoyer.
 *
 * Interdit sur un compte de l'annuaire, et le serveur le revérifie : cette
 * adresse prime sur celle de l'AD pour l'envoi du lien de connexion. La poser sur
 * le compte d'un administrateur revenait à se faire adresser son lien et à ouvrir
 * sa session — un gestionnaire pouvait s'élever au rang d'administrateur sans
 * connaître aucun mot de passe.
 */
export function EmailAgentForm({
  userId,
  emailContact,
  emailAnnuaire,
  modifiable,
}: {
  userId: string;
  emailContact: string | null;
  emailAnnuaire: string | null;
  /** Faux pour un compte de l'annuaire : l'adresse vient de l'AD. */
  modifiable: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    modifierEmailAgent,
    null,
  );

  if (!modifiable) {
    return (
      <div className="space-y-2">
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {emailAnnuaire ?? "Aucune adresse dans l'annuaire"}
        </p>
        <p className="text-xs text-slate-500">
          Elle vient de l&apos;Active Directory et s&apos;y corrige : l&apos;application la relit
          à chaque connexion de l&apos;agent et à chaque synchronisation. La saisir
          ici permettrait de détourner son lien de connexion.
        </p>
      </div>
    );
  }

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
      <p className="text-xs text-slate-500">
        Si l&apos;agent a déjà un compte dans l&apos;application, les deux fiches sont fusionnées et
        vous arrivez sur celle qui subsiste. L&apos;opération ne se défait pas.
      </p>
    </form>
  );
}

/**
 * Service de rattachement, choisi dans le référentiel.
 *
 * Le service affiché est d'ordinaire calculé depuis l'annuaire ; ce formulaire
 * sert quand l'annuaire se trompe ou retarde. Le choix fait ici est FORCÉ : la
 * synchronisation ne le réécrit pas. L'option « celui de l'annuaire » rend la
 * main aux règles — c'est le seul moyen de défaire un forçage, et il doit être
 * visible, sinon une correction d'un jour survit à toutes les mutations.
 */
export function ServiceAgentForm({
  userId,
  service,
  force,
  brut,
  services,
}: {
  userId: string;
  service: string | null;
  /** Vrai si le rattachement a été décidé à la main. */
  force: boolean;
  /** Libellé brut de l'annuaire, s'il y en a un. */
  brut: string | null;
  services: string[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    modifierServiceAgent,
    null,
  );
  // Un service retiré du référentiel reste affiché sur la fiche : on le
  // propose pour que le <select> montre bien la valeur en place.
  const options = service && !services.includes(service) ? [service, ...services] : services;

  return (
    <form action={action} className="space-y-3">
      <Alert state={state} />
      <input type="hidden" name="userId" value={userId} />
      <Field
        label="Service"
        hint={
          services.length === 0
            ? "Le référentiel est vide : déclarez les services dans Paramètres → Services."
            : force
              ? "Rattachement décidé ici : la synchronisation de l'annuaire ne le modifie pas."
              : brut
                ? `Calculé depuis l'annuaire (« ${brut} ») et les regroupements. Choisir un service ici fige la décision.`
                : "Aucun libellé dans l'annuaire. Choisir un service ici fige la décision."
        }
      >
        <Select name="service" defaultValue={force ? (service ?? "") : "__annuaire"}>
          <option value="__annuaire">
            {brut
              ? `Celui de l'annuaire${!force && service ? ` — ${service}` : ""}`
              : "Celui de l'annuaire (aucun)"}
          </option>
          <option value="">Aucun service</option>
          {options.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton className={btnSecondary} pendingLabel="Enregistrement…">
        <Building2 className="h-4 w-4" /> Enregistrer le service
      </SubmitButton>
    </form>
  );
}
