import { History } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getTextesLegaux } from "@/lib/declarations";
import { fmtHorodatage } from "@/lib/dates";
import { Card } from "@/components/ui";
import { TextesForm } from "@/components/textes-form";

/**
 * Déclarations et mentions d'information, éditables.
 *
 * Ces textes sont arbitrés par la DRH et la DPO, pas par la DSI : les figer
 * dans le code obligeait à reconstruire l'image pour corriger une virgule dans
 * une clause de responsabilité. Ils vivent donc en base, versionnés.
 */
export default async function ParametresDeclarations() {
  await requireUser("GESTIONNAIRE");

  const [textes, versions] = await Promise.all([
    getTextesLegaux(),
    prisma.texteLegal.findMany({ orderBy: { creeLe: "desc" }, take: 10 }),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <p className="text-sm">
          Version en vigueur : <strong className="font-semibold">{textes.version}</strong>
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Ces textes s&apos;affichent quand un agent choisit un créneau, et sur la page
          publique des mentions d&apos;information. Une inscription enregistre le numéro
          de version acceptée — corriger un texte ne réécrit donc jamais ce qu&apos;un
          agent déjà inscrit a lu.
        </p>
      </Card>

      <TextesForm textes={textes} />

      {versions.length > 0 && (
        <Card
          title="Versions publiées"
          action={<History className="h-4 w-4 text-slate-300" />}
        >
          <ul className="divide-y divide-slate-100 text-xs">
            {versions.map((v) => (
              <li key={v.version} className="flex items-center justify-between gap-4 py-2">
                <span className="font-medium tabular-nums">{v.version}</span>
                <span className="text-slate-400">
                  {fmtHorodatage(v.creeLe)}
                  {v.creePar && ` · ${v.creePar}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
