import { prisma } from "@/lib/db";
import { getLdapSettings } from "@/lib/settings";
import { Card, Stat } from "@/components/ui";
import { LdapForm, LdapOutils } from "@/components/settings-forms";
import { fmtHorodatage } from "@/lib/dates";

export default async function ParametresAnnuaire() {
  const [cfg, comptes, dernier] = await Promise.all([
    getLdapSettings(),
    prisma.adAccount.count(),
    prisma.adAccount.findFirst({ orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Comptes en miroir" value={comptes} />
        <Stat
          label="Dernière synchronisation"
          value={dernier ? fmtHorodatage(dernier.syncedAt) : "jamais"}
        />
        <Stat
          label="Chiffrement"
          value={cfg?.useSsl || cfg?.url?.startsWith("ldaps://") ? "LDAPS" : "LDAP"}
          accent={
            cfg?.useSsl || cfg?.url?.startsWith("ldaps://")
              ? "text-emerald-600 bg-emerald-50"
              : "text-amber-600 bg-amber-50"
          }
        />
      </div>

      <Card title="Outils">
        <LdapOutils />
      </Card>

      <Card title="Connexion à l'Active Directory">
        <LdapForm cfg={cfg} />
      </Card>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
        <p className="mb-2 font-medium text-slate-700">Rappel d&apos;architecture</p>
        <p>
          Le contrôleur de domaine n&apos;est jamais exposé : Bolt l&apos;interroge
          depuis le réseau interne. Les animateurs extérieurs n&apos;utilisent pas
          l&apos;annuaire — leur accès repose sur un lien à jeton et un code à
          6 chiffres, sans identité de domaine.
        </p>
      </div>
    </div>
  );
}
