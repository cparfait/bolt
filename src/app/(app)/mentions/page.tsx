import { ShieldCheck } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { getTextesLegaux } from "@/lib/declarations";
import { TexteEnLigne, TexteMisEnForme } from "@/components/texte-mis-en-forme";

export const metadata = { title: "Mentions d'information" };

/**
 * Les textes acceptés à l'inscription, consultables en permanence.
 *
 * La boîte d'inscription les présente au moment où ils engagent l'agent ; cette
 * page-ci répond à l'autre besoin, qui vient plus tard : « qu'est-ce que j'ai
 * accepté au juste, et à qui j'écris pour le retirer ». Un consentement qu'on
 * ne peut plus relire une fois donné n'en est pas tout à fait un.
 */
export default async function MentionsPage() {
  const textes = await getTextesLegaux();

  return (
    <>
      <PageHeader
        title="Mentions d'information"
        subtitle={`Textes acceptés lors d'une inscription en ligne — version ${textes.version}`}
      />

      <div className="space-y-6">
        <Card title="Déclarations de l'agent">
          <p className="text-xs text-slate-500">
            Reprises de la fiche d&apos;inscription papier, elles sont toutes
            obligatoires pour s&apos;inscrire à une activité.
          </p>
          <ul className="mt-3 space-y-2.5">
            {textes.declarations.map((d) => (
              <li
                key={d.cle}
                className="rounded-xl border border-slate-200 p-3 text-xs leading-relaxed"
              >
                <TexteEnLigne texte={d.texte} />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Traitement des données personnelles">
          <TexteMisEnForme
            texte={textes.rgpdPreambule}
            className="text-xs leading-relaxed text-slate-500"
          />
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600">
            {textes.mentions.map((m) => (
              <li key={m.intitule}>
                <strong className="font-semibold text-slate-900">{m.intitule}</strong> :{" "}
                <TexteEnLigne texte={m.texte} />
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <TexteMisEnForme
              texte={textes.rgpdRecours}
              className="text-xs leading-relaxed text-slate-500"
            />
          </div>

          <p className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs leading-relaxed text-slate-600">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <span>
              <TexteEnLigne texte={textes.rgpdConsentement} />
            </span>
          </p>
        </Card>
      </div>
    </>
  );
}
