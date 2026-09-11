"use client";

import { useActionState } from "react";
import type { CoachAcces } from "@prisma/client";
import { enregistrerAnimateur } from "@/lib/actions/animateurs";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, Textarea, btnPrimary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export type AnimateurInitial = {
  id: string;
  nom: string;
  prenom: string;
  email: string | null;
  telephone: string | null;
  organisme: string | null;
  acces: CoachAcces;
  notes: string | null;
  login: string | null;
};

/**
 * Fiche animateur.
 *
 * Une seule case pour l'accès, et elle n'apparaît que pour la DSI : rattacher
 * un animateur à un compte de domaine ouvre un accès au système d'information,
 * ce qui ne relève pas du service des sports — il n'a d'ailleurs aucun moyen de
 * vérifier qu'un identifiant Windows désigne bien la bonne personne. Pour tous
 * les autres, le champ est absent et le rattachement d'une fiche existante
 * reste ce qu'il est. Le masquage n'est que du confort : c'est
 * `enregistrerAnimateur` qui refuse le changement.
 *
 * Une case, et pas un choix de mode, parce qu'il n'y a plus rien à trancher.
 * Le lien et le code à six chiffres sont acquis à tout le monde ; le compte
 * réseau ne fait qu'ajouter une seconde porte, celle du poste de bureau, à
 * l'animateur agent de la collectivité. Renseignée, elle rattache ; vidée, elle
 * détache. Demander « quel mode d'accès ? » à chaque création posait une
 * question dont la réponse était presque toujours « aucun », dans un
 * vocabulaire que seule la DSI lit couramment.
 */
export function AnimateurForm({
  initial,
  estAdmin = false,
}: {
  initial?: AnimateurInitial;
  estAdmin?: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    enregistrerAnimateur,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <Alert state={state} />
      {initial && <input type="hidden" name="id" value={initial.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prénom" required>
          <Input name="prenom" defaultValue={initial?.prenom} required />
        </Field>
        <Field label="Nom" required>
          <Input name="nom" defaultValue={initial?.nom} required />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="E-mail" hint="Pour lui transmettre son accès.">
          <Input name="email" type="email" defaultValue={initial?.email ?? ""} />
        </Field>
        <Field label="Téléphone">
          <Input name="telephone" defaultValue={initial?.telephone ?? ""} />
        </Field>
      </div>

      <Field label="Organisme" hint="Association ou prestataire employeur, le cas échéant.">
        <Input name="organisme" defaultValue={initial?.organisme ?? ""} />
      </Field>

      {estAdmin && (
        <Field
          label="Compte réseau"
          hint="Identifiant Windows de l'animateur, s'il est agent de la collectivité : il pourra alors pointer depuis un poste du réseau, en plus de son code. À laisser vide pour un prestataire extérieur."
        >
          <Input
            name="login"
            defaultValue={initial?.acces === "AD" ? (initial.login ?? "") : ""}
            autoComplete="off"
            placeholder="prenom.nom"
          />
        </Field>
      )}

      {estAdmin && initial?.acces === "LOCAL" && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Cet animateur se connecte encore avec un identifiant local, hérité d&apos;une
          version précédente de l&apos;application. Renseignez son compte réseau pour le
          remplacer&nbsp;; tant que la case reste vide, son identifiant actuel continue
          de fonctionner.
        </p>
      )}

      <Field label="Notes internes">
        <Textarea name="notes" defaultValue={initial?.notes ?? ""} rows={2} />
      </Field>

      <SubmitButton className={btnPrimary}>
        {initial ? "Enregistrer" : "Créer l'animateur"}
      </SubmitButton>
    </form>
  );
}
