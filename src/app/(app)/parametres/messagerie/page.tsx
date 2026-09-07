import { requireUser } from "@/lib/session";
import { getSmtpSettings } from "@/lib/settings";
import { Card } from "@/components/ui";
import { SmtpForm } from "@/components/settings-forms";
import { MailsExemples } from "@/components/mails-exemples";
import { exemplesMail } from "@/lib/mail-exemples";
import { apercu } from "@/lib/mail";

export const dynamic = "force-dynamic";

export default async function ParametresMessagerie() {
  await requireUser("ADMIN");
  const [cfg, exemples] = await Promise.all([getSmtpSettings(), exemplesMail()]);
  const configuree = Boolean(cfg?.host && cfg?.from);

  return (
    <div className="space-y-6">
      <Card title="Envoi d'e-mails (SMTP)">
        <SmtpForm cfg={cfg} />
      </Card>

      {/* La liste des messages, et de quoi se les envoyer. Elle remplace
          l'énumération en puces qui tenait lieu de documentation : dire qu'on
          envoie « une confirmation d'inscription » n'apprend rien sur ce que
          l'agent lit réellement. */}
      <Card title={`Messages envoyés par l'application (${exemples.length})`}>
        <p className="mb-4 text-sm text-slate-500">
          Voici tout ce que Bolt écrit, à qui, et à quel moment. « Voir » ouvre
          le message tel qu&apos;il arrive dans une boîte de réception. L&apos;envoi
          sert la démonstration : il permet de montrer un courriel d&apos;annulation
          sans annuler de séance, et une confirmation sans inscrire personne.
        </p>
        {!configuree && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
            La messagerie n&apos;est pas configurée : les aperçus fonctionnent,
            l&apos;envoi non.
          </p>
        )}
        <MailsExemples
          exemples={exemples.map((e) => ({
            cle: e.cle,
            titre: e.titre,
            quand: e.quand,
            destinataire: e.destinataire,
            objet: e.objet,
            apercu: apercu(e.corps),
          }))}
        />
      </Card>

      <p className="text-xs text-slate-500">
        Ces exemples portent des données fictives et un objet préfixé
        « [Exemple] ». Ils ne sont adressés qu&apos;à l&apos;adresse saisie
        ci-dessus, jamais à un agent, et n&apos;écrivent rien en base : envoyer
        une confirmation d&apos;inscription d&apos;exemple n&apos;inscrit
        personne.
      </p>
    </div>
  );
}
