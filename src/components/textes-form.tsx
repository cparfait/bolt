"use client";

import { useActionState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { enregistrerTextes } from "@/lib/actions/parametres";
import type { ActionState } from "@/lib/actions/types";
import type { TextesLegaux } from "@/lib/declarations";
import { EditeurTexte } from "@/components/editeur-texte";
import { Alert, Card, Input, btnPrimary } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/**
 * Édition des déclarations et des mentions d'information.
 *
 * Un seul formulaire pour l'ensemble : ces textes forment un tout juridique,
 * et les enregistrer séparément publierait trois versions là où la DRH n'a
 * validé qu'une relecture.
 */
export function TextesForm({ textes }: { textes: TextesLegaux }) {
  const [state, action] = useActionState<ActionState, FormData>(enregistrerTextes, null);

  const retirer = (nom: string, quoi: string) => (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400 transition hover:text-red-600">
      <input type="checkbox" name={nom} className="h-3.5 w-3.5 accent-red-600" />
      <Trash2 className="h-3.5 w-3.5" />
      Retirer {quoi}
    </label>
  );

  return (
    <form action={action} className="space-y-6">
      <Alert state={state} />

      <Card title="Déclarations acceptées à l'inscription">
        <p className="text-xs text-slate-500">
          Chacune devient une case à cocher, obligatoire, dans la fenêtre qui
          s&apos;ouvre quand un agent choisit un créneau. Mettez en gras les premiers
          mots : ils servent à désigner la déclaration dans les messages d&apos;erreur.
        </p>

        <div className="mt-4 space-y-5">
          {textes.declarations.map((d, i) => (
            <div key={d.cle} className="rounded-xl border border-slate-200 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Déclaration {i + 1}
                </span>
                {retirer(`retirer_${d.cle}`, "")}
              </div>
              <EditeurTexte name={`declaration_${d.cle}`} defaultValue={d.texte} lignes={4} />
            </div>
          ))}

          <div className="rounded-xl border border-dashed border-slate-300 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Plus className="h-3.5 w-3.5" />
              Ajouter une déclaration
            </p>
            <EditeurTexte
              name="nouvelleDeclaration"
              defaultValue=""
              lignes={3}
              aide="Laissez vide pour n'en ajouter aucune."
            />
          </div>
        </div>
      </Card>

      <Card title="Mentions d'information (RGPD)">
        <EditeurTexte
          name="rgpdPreambule"
          defaultValue={textes.rgpdPreambule}
          label="Préambule"
          lignes={3}
        />

        <div className="mt-5 space-y-5">
          {textes.mentions.map((m) => (
            <div key={m.intitule} className="rounded-xl border border-slate-200 p-4">
              <div className="mb-2 flex items-end justify-between gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Intitulé
                  </label>
                  <Input name={`intitule_${m.intitule}`} defaultValue={m.intitule} />
                </div>
                {retirer(`retirerMention_${m.intitule}`, "")}
              </div>
              <EditeurTexte name={`mention_${m.intitule}`} defaultValue={m.texte} lignes={3} />
            </div>
          ))}

          <div className="rounded-xl border border-dashed border-slate-300 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Plus className="h-3.5 w-3.5" />
              Ajouter une mention
            </p>
            <label className="mb-1 block text-xs font-medium text-slate-600">Intitulé</label>
            <Input name="nouvelIntitule" placeholder="Transferts hors Union européenne" />
            <div className="mt-2">
              <EditeurTexte
                name="nouvelleMention"
                defaultValue=""
                lignes={3}
                aide="L'intitulé et le texte doivent être renseignés tous les deux."
              />
            </div>
          </div>
        </div>

        <div className="mt-5">
          <EditeurTexte
            name="rgpdRecours"
            defaultValue={textes.rgpdRecours}
            label="Recours (CNIL)"
            lignes={4}
          />
        </div>

        <div className="mt-5">
          <EditeurTexte
            name="rgpdConsentement"
            defaultValue={textes.rgpdConsentement}
            label="Phrase de consentement"
            aide="C'est la phrase que l'agent coche. Elle ne peut pas être vide."
            lignes={3}
          />
        </div>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-slate-400">
          Publier crée une nouvelle version. Les inscriptions déjà enregistrées gardent
          la trace de celle qu&apos;elles ont acceptée.
        </p>
        <SubmitButton className={btnPrimary} pendingLabel="Publication…">
          Publier ces textes
        </SubmitButton>
      </div>
    </form>
  );
}
