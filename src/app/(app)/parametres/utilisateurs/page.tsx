import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getLdapSettings } from "@/lib/settings";
import { Card, EmptyState } from "@/components/ui";
import { UsersTable } from "@/components/users-table";

export default async function ParametresUtilisateurs() {
  const moi = await requireUser("ADMIN");
  const [utilisateurs, ldap] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ active: "desc" }, { role: "asc" }, { displayName: "asc" }],
      select: {
        id: true,
        login: true,
        displayName: true,
        email: true,
        role: true,
        isLocal: true,
        active: true,
        service: true,
        lastLoginAt: true,
      },
      take: 500,
    }),
    getLdapSettings(),
  ]);

  return (
    <div className="space-y-6">
      {ldap?.gestionnaireGroup && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Le groupe Active Directory{" "}
          <span className="font-semibold">{ldap.gestionnaireGroup}</span> fait autorité
          sur le rôle « Service des sports » : une promotion manuelle sera écrasée à la
          prochaine connexion de l&apos;agent. Les rôles Administrateur et Animateur ne
          sont pas concernés.
        </div>
      )}

      <Card title={`Comptes (${utilisateurs.length})`}>
        {utilisateurs.length === 0 ? (
          <EmptyState title="Aucun compte" />
        ) : (
          <UsersTable utilisateurs={utilisateurs} moi={moi.id} />
        )}
      </Card>
    </div>
  );
}
