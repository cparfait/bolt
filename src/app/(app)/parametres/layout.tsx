import Link from "next/link";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { OngletsParametres } from "@/components/settings-tabs";

export default async function ParametresLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireUser("ADMIN");
  return (
    <>
      <PageHeader title="Paramètres" subtitle="Configuration de Bolt">
        <Link
          href="/"
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          Retour au tableau de bord
        </Link>
      </PageHeader>
      <OngletsParametres />
      <div className="mt-6">{children}</div>
    </>
  );
}
