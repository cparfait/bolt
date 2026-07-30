import { requireUser } from "@/lib/session";
import { getSmtpSettings } from "@/lib/settings";
import { Card } from "@/components/ui";
import { SmtpForm } from "@/components/settings-forms";

export default async function ParametresMessagerie() {
  await requireUser("ADMIN");
  const cfg = await getSmtpSettings();
  return (
    <div className="space-y-6">
      <Card title="Envoi d'e-mails (SMTP)">
        <SmtpForm cfg={cfg} />
      </Card>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
        <p className="mb-2 font-medium text-slate-700">Messages envoyés par l&apos;application</p>
        <ul className="list-inside list-disc space-y-1">
          <li>lien d&apos;émargement et code à un animateur ;</li>
          <li>confirmation ou refus d&apos;une inscription ;</li>
          <li>place libérée pour un agent en liste d&apos;attente ;</li>
          <li>relance des agents qui ne viennent plus ;</li>
          <li>lien de connexion, si la connexion par e-mail est activée.</li>
        </ul>
      </div>
    </div>
  );
}
