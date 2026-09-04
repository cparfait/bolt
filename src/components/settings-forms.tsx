"use client";

import { useActionState, useRef, useState } from "react";
import { ImagePlus, Plug, RefreshCw, Save, Send, X } from "lucide-react";
import {
  enregistrerGeneral,
  enregistrerLdap,
  enregistrerSmtp,
  synchroniserAnnuaire,
  testerLdap,
} from "@/lib/actions/parametres";
import type { ActionState } from "@/lib/actions/types";
import { Alert, Field, Input, btnPrimary, btnSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ChampGroupe } from "@/components/champ-groupe";
import type { GeneralSettings, LdapSettings, SmtpSettings } from "@/lib/settings";

export function LdapForm({ cfg }: { cfg: LdapSettings | null }) {
  const [state, action] = useActionState<ActionState, FormData>(enregistrerLdap, null);
  return (
    <form action={action} className="space-y-4">
      <Alert state={state} />

      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={cfg?.enabled !== false}
          className="h-4 w-4 rounded border-slate-300"
        />
        Authentification Active Directory activée
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Serveur"
          required
          className="sm:col-span-2"
          hint="ldaps://dc01.collectivite.lan — ou simplement le nom d'hôte."
        >
          <Input name="url" defaultValue={cfg?.url ?? ""} required placeholder="ldaps://dc01.collectivite.lan" />
        </Field>
        <Field label="Port" hint="636 en LDAPS, 389 sinon.">
          <Input name="port" type="number" defaultValue={cfg?.port ?? ""} placeholder="636" />
        </Field>
      </div>

      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="useSsl"
            defaultChecked={cfg?.useSsl ?? true}
            className="h-4 w-4 rounded border-slate-300"
          />
          Forcer LDAPS (chiffrement)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="tlsRejectUnauthorized"
            defaultChecked={cfg?.tlsRejectUnauthorized ?? true}
            className="h-4 w-4 rounded border-slate-300"
          />
          Vérifier le certificat du serveur
        </label>
      </div>

      <Field
        label="Certificat de l'autorité interne"
        hint="Chemin d'un fichier PEM sur le serveur, ou contenu du certificat collé. Nécessaire si votre AC n'est pas publique — préférable à la désactivation de la vérification."
      >
        <Input name="caCert" defaultValue={cfg?.caCert ?? ""} placeholder="/certs/ac-interne.pem" />
      </Field>

      <Field label="Base DN" required>
        <Input name="baseDn" defaultValue={cfg?.baseDn ?? ""} required placeholder="DC=collectivite,DC=lan" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Compte de service (DN ou UPN)" hint="Lecture seule. Sert à la synchronisation.">
          <Input
            name="bindDn"
            defaultValue={cfg?.bindDn ?? ""}
            autoComplete="off"
            placeholder="svc-bolt@collectivite.lan"
          />
        </Field>
        <Field
          label="Mot de passe du compte de service"
          hint={cfg?.bindPassword ? "Renseigné — laisser vide pour le conserver." : undefined}
        >
          <Input name="bindPassword" type="password" autoComplete="new-password" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Suffixe UPN" hint="Connexion en identifiant@suffixe si aucun compte de service.">
          <Input name="upnSuffix" defaultValue={cfg?.upnSuffix ?? ""} placeholder="collectivite.lan" />
        </Field>
        <Field label="Gabarit DN utilisateur" hint="Jeton {username}. Rarement nécessaire.">
          <Input
            name="userDnTemplate"
            defaultValue={cfg?.userDnTemplate ?? ""}
            placeholder="CN={username},OU=Agents,DC=collectivite,DC=lan"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ChampGroupe
          name="requiredGroup"
          label="Groupe AD requis"
          hint="Seuls ses membres (groupes imbriqués inclus) peuvent se connecter."
          defaultValue={cfg?.requiredGroup ?? ""}
          placeholder="GG-Bolt-Utilisateurs"
        />
        <ChampGroupe
          name="gestionnaireGroup"
          label="Groupe « service des sports »"
          hint="Ses membres deviennent gestionnaires. Le groupe fait autorité : un non-membre est rétrogradé agent."
          defaultValue={cfg?.gestionnaireGroup ?? ""}
          placeholder="GG-Bolt-Sports"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <SubmitButton className={btnPrimary}>
          <Save className="h-4 w-4" /> Enregistrer
        </SubmitButton>
        <button type="submit" name="tester" value="1" className={btnSecondary}>
          <Plug className="h-4 w-4" /> Enregistrer et tester
        </button>
      </div>
    </form>
  );
}

export function LdapOutils() {
  // Ces deux actions ne lisent rien du formulaire : le FormData est ignoré.
  const [test, actionTest] = useActionState<ActionState, FormData>(
    async () => testerLdap(),
    null,
  );
  const [sync, actionSync] = useActionState<ActionState, FormData>(
    async () => synchroniserAnnuaire(),
    null,
  );
  return (
    <div className="space-y-3">
      <Alert state={test} />
      <Alert state={sync} />
      <div className="flex flex-wrap gap-2">
        <form action={actionTest}>
          <SubmitButton className={btnSecondary} pendingLabel="Test en cours…">
            <Plug className="h-4 w-4" /> Tester la connexion
          </SubmitButton>
        </form>
        <form action={actionSync}>
          <SubmitButton className={btnSecondary} pendingLabel="Synchronisation…">
            <RefreshCw className="h-4 w-4" /> Synchroniser l&apos;annuaire
          </SubmitButton>
        </form>
      </div>
      <p className="text-xs text-slate-400">
        La synchronisation est en lecture seule : l&apos;application n&apos;écrit jamais dans
        l&apos;Active Directory.
      </p>
    </div>
  );
}

export function SmtpForm({ cfg }: { cfg: SmtpSettings | null }) {
  const [state, action] = useActionState<ActionState, FormData>(enregistrerSmtp, null);
  return (
    <form action={action} className="space-y-4">
      <Alert state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Serveur SMTP" required className="sm:col-span-2">
          <Input name="host" defaultValue={cfg?.host ?? ""} required placeholder="smtp.collectivite.lan" />
        </Field>
        <Field label="Port" required>
          <Input name="port" type="number" defaultValue={cfg?.port ?? 25} required />
        </Field>
      </div>
      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="secure"
            defaultChecked={cfg?.secure ?? false}
            className="h-4 w-4 rounded border-slate-300"
          />
          Connexion TLS implicite (port 465)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="tlsRejectUnauthorized"
            defaultChecked={cfg?.tlsRejectUnauthorized !== false}
            className="h-4 w-4 rounded border-slate-300"
          />
          Vérifier le certificat
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Utilisateur" hint="Laisser vide si le relais n'exige pas d'authentification.">
          <Input name="user" defaultValue={cfg?.user ?? ""} autoComplete="off" />
        </Field>
        <Field
          label="Mot de passe"
          hint={cfg?.pass ? "Renseigné — laisser vide pour le conserver." : undefined}
        >
          <Input name="pass" type="password" autoComplete="new-password" />
        </Field>
      </div>
      <Field label="Expéditeur" required>
        <Input
          name="from"
          defaultValue={cfg?.from ?? ""}
          required
          placeholder="Bolt <sport@collectivite.fr>"
        />
      </Field>
      <Field
        label="Envoyer un message de test à"
        hint="La configuration est enregistrée avant l'envoi, dans les deux cas."
      >
        <Input name="test" type="email" placeholder="vous@collectivite.fr" />
      </Field>

      <div className="flex flex-wrap gap-2">
        <SubmitButton className={btnPrimary}>
          <Save className="h-4 w-4" /> Enregistrer
        </SubmitButton>
        <button type="submit" name="tester" value="1" className={btnSecondary}>
          <Send className="h-4 w-4" /> Enregistrer et envoyer le test
        </button>
      </div>
    </form>
  );
}

/**
 * Import du logo : l'aperçu se met à jour dès le choix du fichier, avant même
 * l'enregistrement. « supprimerLogo » n'est envoyé que si l'utilisateur retire
 * le logo existant sans en choisir un autre — côté serveur, un champ fichier
 * vide conserve l'existant.
 */
function ChampLogo({ actuel }: { actuel: string }) {
  const [apercu, setApercu] = useState(actuel);
  const fichierRef = useRef<HTMLInputElement>(null);

  const choisir = (fichier: File | undefined) => {
    if (!fichier) return;
    const lecteur = new FileReader();
    lecteur.onload = () => setApercu(String(lecteur.result));
    lecteur.readAsDataURL(fichier);
  };

  const retirer = () => {
    if (fichierRef.current) fichierRef.current.value = "";
    setApercu("");
  };

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700">Logo</span>
      <input
        ref={fichierRef}
        type="file"
        name="logo"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => choisir(e.target.files?.[0] ?? undefined)}
      />
      {!apercu && actuel && <input type="hidden" name="supprimerLogo" value="1" />}
      <div className="flex items-stretch gap-3">
        <button
          type="button"
          onClick={() => fichierRef.current?.click()}
          className="flex min-h-20 flex-1 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 transition hover:border-brand-600 hover:bg-white"
        >
          {apercu ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URI, next/image ne s'applique pas
            <img
              src={apercu}
              alt="Aperçu du logo"
              className="max-h-14 w-auto max-w-full object-contain"
            />
          ) : (
            <span className="flex items-center gap-2 text-sm text-slate-500">
              <ImagePlus className="h-4 w-4" />
              Choisir une image…
            </span>
          )}
        </button>
        {apercu && (
          <button type="button" onClick={retirer} className={btnSecondary} title="Retirer le logo">
            <X className="h-4 w-4" />
            Retirer
          </button>
        )}
      </div>
      <span className="mt-1 block text-xs text-slate-500">
        Affiché sur la page de connexion. PNG, JPEG, WebP ou SVG, 300 Ko maximum.
        {apercu !== actuel && " N'oubliez pas d'enregistrer."}
      </span>
    </div>
  );
}

/** Valeur affichée sans champ de saisie : réglage réservé à la DSI. */
function ValeurReservee({ valeur }: { valeur: string }) {
  return (
    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
      {valeur || "Non renseignée"}
      <span className="ml-2 text-xs text-slate-400">— réservé à la DSI</span>
    </p>
  );
}

/**
 * Paramètres généraux. Les deux URL publiques ne sont modifiables que par la
 * DSI : elles décident où pointent les liens de connexion envoyés par courriel.
 * Le service des sports les voit — c'est utile pour comprendre ce qu'un agent
 * reçoit — mais en lecture seule, et le serveur le revérifie.
 */
export function GeneralForm({
  cfg,
  estAdmin,
}: {
  cfg: GeneralSettings;
  estAdmin: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(enregistrerGeneral, null);
  return (
    <form action={action} className="space-y-4">
      <Alert state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Nom de l'application"
          required
          hint="Affiché sur les écrans de connexion, dans la navigation, l'onglet du navigateur, les courriels et l'application installée par les animateurs."
        >
          <Input name="appName" defaultValue={cfg.appName} required maxLength={40} />
        </Field>
        <Field label="Ce qu'elle fait" hint="Accompagne le nom, en plus discret.">
          <Input
            name="appDescription"
            defaultValue={cfg.appDescription}
            maxLength={60}
            placeholder="Gestion des activités sportives"
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom de la collectivité" required>
          <Input name="orgName" defaultValue={cfg.orgName} required />
        </Field>
        <Field label="Contact du service des sports" hint="Affiché aux agents et aux animateurs.">
          <Input name="contactEmail" type="email" defaultValue={cfg.contactEmail} />
        </Field>
      </div>
      <Field
        label="URL principale de l'application"
        hint="Nom par lequel l'application est jointe depuis le réseau. Sert aux liens des courriels internes, et de repli si l'URL publique ci-dessous est vide."
      >
        {estAdmin ? (
          <Input
            name="appUrl"
            defaultValue={cfg.appUrl}
            placeholder="https://bolt.collectivite.fr"
          />
        ) : (
          <ValeurReservee valeur={cfg.appUrl} />
        )}
      </Field>

      <Field
        label="URL publique"
        hint="Nom par lequel agents et animateurs joignent l'application depuis Internet : liens d'émargement ET liens de connexion des agents. Laissez vide si l'application n'a qu'un seul nom."
      >
        {estAdmin ? (
          <Input
            name="pointageUrl"
            defaultValue={cfg.pointageUrl}
            placeholder="https://sport.collectivite.fr"
          />
        ) : (
          <ValeurReservee valeur={cfg.pointageUrl} />
        )}
      </Field>

      <ChampLogo actuel={cfg.logo} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Activités maximum par agent"
          hint="Compté en activités : suivre deux créneaux d'une même activité n'en consomme qu'une. 0 = pas de limite."
        >
          <Input
            name="maxInscriptionsParAgent"
            type="number"
            min={0}
            defaultValue={cfg.maxInscriptionsParAgent}
          />
        </Field>
        <Field
          label="Absences avant relance"
          hint="Seuil de détection des agents qui ne viennent plus."
        >
          <Input
            name="absencesAvantRelance"
            type="number"
            min={1}
            defaultValue={cfg.absencesAvantRelance}
          />
        </Field>
        <Field
          label="Conservation des inscriptions (mois)"
          hint="Doit correspondre à la durée annoncée dans vos mentions d'information. La purge ne part jamais seule : elle se déclenche depuis Paramètres → Journal. 0 = aucune purge."
        >
          <Input
            name="conservationMois"
            type="number"
            min={0}
            defaultValue={cfg.conservationMois}
          />
        </Field>
      </div>

      <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-3 text-sm">
        <input
          type="checkbox"
          name="validationRequise"
          defaultChecked={cfg.validationRequise}
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>
          <span className="block font-medium">Valider chaque demande d&apos;inscription</span>
          <span className="block text-xs text-slate-500">
            Décoché, l&apos;agent est inscrit immédiatement s&apos;il reste de la place.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-3 text-sm">
        <input
          type="checkbox"
          name="lienMagiqueActif"
          defaultChecked={cfg.lienMagiqueActif}
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>
          <span className="block font-medium">
            Connexion des agents par lien e-mail
          </span>
          <span className="block text-xs text-slate-500">
            Pour les agents sans poste sur le réseau. Seules les adresses connues de
            l&apos;annuaire reçoivent un lien — aucun compte ne peut être créé de
            toutes pièces. Nécessite la messagerie configurée, et la variable
            PUBLIC_AGENT_ACCESS=1 si l&apos;accès doit fonctionner hors du réseau.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-3 text-sm">
        <input
          type="checkbox"
          name="demandeAccesActive"
          defaultChecked={cfg.demandeAccesActive}
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>
          <span className="block font-medium">
            Formulaire public de demande d&apos;accès
          </span>
          <span className="block text-xs text-slate-500">
            Pour les personnes absentes de l&apos;annuaire : vacataire, contrat
            court, agent d&apos;un autre organisme. Une demande ne crée ni compte
            ni session et n&apos;envoie rien à l&apos;adresse saisie : elle vous est
            signalée, et vous la validez d&apos;un clic. Suppose la connexion par
            lien activée.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-3 text-sm">
        <input
          type="checkbox"
          name="rappelsActifs"
          defaultChecked={cfg.rappelsActifs}
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span className="flex-1">
          <span className="block font-medium">Rappel de séance par e-mail</span>
          <span className="block text-xs text-slate-500">
            Envoyé aux inscrits avant leur séance. Chaque séance n&apos;est
            rappelée qu&apos;une fois. Déclenché par le trafic sur
            l&apos;application — aucun ordonnanceur n&apos;est nécessaire.
          </span>
          <span className="mt-2 flex items-center gap-2">
            <input
              name="rappelHeuresAvant"
              type="number"
              min={1}
              max={168}
              defaultValue={cfg.rappelHeuresAvant}
              className="w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500"
            />
            <span className="text-xs text-slate-500">heures avant la séance</span>
          </span>
        </span>
      </label>

      <SubmitButton className={btnPrimary}>
        <Save className="h-4 w-4" /> Enregistrer
      </SubmitButton>
    </form>
  );
}
