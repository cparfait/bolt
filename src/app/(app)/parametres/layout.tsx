import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getGeneralSettings } from "@/lib/settings";
import { PageHeader } from "@/components/ui";
import { OngletsParametres } from "@/components/settings-tabs";

export default async function ParametresLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Le service des sports accède au paramétrage métier (général, saisons,
  // lieux) ; les onglets techniques restent gardés page par page côté ADMIN.
  const user = await requireUser("GESTIONNAIRE");
  const g = await getGeneralSettings();
  return (
    <>
      <PageHeader title="Paramètres" subtitle={`Configuration de ${g.appName}`}>
        <Link
          href="/"
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          Retour au tableau de bord
        </Link>
      </PageHeader>
      <OngletsParametres estAdmin={user.role === "ADMIN"} />
      <div className="mt-6">{children}</div>
    </>
  );
}
