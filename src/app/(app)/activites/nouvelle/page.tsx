import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { ActiviteForm } from "@/components/activite-form";

export default async function NouvelleActivitePage() {
  await requireUser("GESTIONNAIRE");
  return (
    <>
      <Link
        href="/activites"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux activités
      </Link>

      <PageHeader
        title="Nouvelle activité"
        subtitle="Yoga, aquagym, zumba… Les créneaux horaires se définissent ensuite."
      />

      <Card className="max-w-2xl">
        {/* Une fois créée, on enchaîne directement sur sa page de gestion :
            une activité sans créneau ne sert à rien. */}
        <ActiviteForm redirigerVersFiche />
      </Card>
    </>
  );
}
