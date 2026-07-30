"use client";

import { useTransition } from "react";
import type { Role } from "@prisma/client";
import { basculerUtilisateur, changerRole } from "@/lib/actions/parametres";
import { estCreeALaMain } from "@/lib/comptes";
import { ROLE_LABELS } from "@/lib/constants";
import { fmtHorodatage } from "@/lib/dates";

export type LigneUtilisateur = {
  id: string;
  login: string;
  displayName: string;
  email: string | null;
  role: Role;
  isLocal: boolean;
  active: boolean;
  service: string | null;
  lastLoginAt: Date | null;
};

const ROLES: Role[] = ["ADMIN", "GESTIONNAIRE", "COACH", "AGENT"];

function origine(u: LigneUtilisateur): string {
  if (u.isLocal) return "Compte local";
  if (estCreeALaMain(u.login)) return "Hors annuaire";
  return "Active Directory";
}

export function UsersTable({
  utilisateurs,
  moi,
}: {
  utilisateurs: LigneUtilisateur[];
  moi: string;
}) {
  const [, start] = useTransition();

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="pb-2 font-medium">Utilisateur</th>
            <th className="pb-2 font-medium">Origine</th>
            <th className="pb-2 font-medium">Dernière connexion</th>
            <th className="pb-2 font-medium">Rôle</th>
            <th className="pb-2 text-right font-medium">Actif</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {utilisateurs.map((u) => (
            <tr key={u.id} className={u.active ? "" : "opacity-50"}>
              <td className="py-2.5 pr-3">
                <p className="font-medium">{u.displayName}</p>
                <p className="text-xs text-slate-400">
                  {u.login}
                  {u.email ? ` · ${u.email}` : ""}
                  {u.service ? ` · ${u.service}` : ""}
                </p>
              </td>
              {/* Trois origines, et non deux. « Tout ce qui n'est pas local vient
                  de l'annuaire » était faux : les participants créés à la main —
                  élus, stagiaires, invités — n'ont pas de mot de passe local et
                  n'existent pas davantage dans l'AD. Les afficher comme comptes
                  Active Directory laissait croire que leur adresse @gmail venait
                  de l'annuaire. */}
              <td className="py-2.5 pr-3 text-slate-500">{origine(u)}</td>
              <td className="py-2.5 pr-3 text-slate-500">
                {u.lastLoginAt ? fmtHorodatage(u.lastLoginAt) : "jamais"}
              </td>
              <td className="py-2.5 pr-3">
                <select
                  defaultValue={u.role}
                  disabled={u.id === moi}
                  onChange={(e) =>
                    start(async () => {
                      await changerRole(u.id, e.target.value);
                    })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs outline-none transition focus:border-brand-500 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-2.5 text-right">
                <button
                  type="button"
                  disabled={u.id === moi}
                  onClick={() =>
                    start(async () => {
                      await basculerUtilisateur(u.id);
                    })
                  }
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                    u.active
                      ? "border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-600"
                      : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                  }`}
                >
                  {u.active ? "Désactiver" : "Réactiver"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
