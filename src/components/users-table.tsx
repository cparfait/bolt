"use client";

import { useState, useTransition } from "react";
import type { Role } from "@prisma/client";
import { basculerUtilisateur, changerRole } from "@/lib/actions/parametres";
import { estCreeALaMain } from "@/lib/comptes";
import { ROLE_LABELS } from "@/lib/constants";
import { fmtHorodatage } from "@/lib/dates";
import { Alert } from "@/components/ui";

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

/**
 * Tableau des comptes, avec le changement de rôle et l'ouverture / fermeture
 * de l'accès en ligne.
 *
 * Les deux gestes se confirment. Un rôle se change d'un simple choix dans une
 * liste, et une liste déroulante se dérègle d'un coup de molette : sans garde,
 * un agent devenait administrateur sans que personne ne l'ait voulu, et rien
 * ne le disait. Les actions serveur ne renvoient rien : c'est ici qu'on
 * annonce le résultat, ou l'échec.
 */
export function UsersTable({
  utilisateurs,
  moi,
}: {
  utilisateurs: LigneUtilisateur[];
  moi: string;
}) {
  const [pending, start] = useTransition();
  const [retour, setRetour] = useState<{ error?: string; success?: string } | null>(null);
  // Clé qui force le <select> à reprendre le rôle affiché quand la
  // confirmation est refusée : un select non contrôlé garde sinon le choix
  // qu'on vient de décliner.
  const [version, setVersion] = useState(0);

  function modifierRole(u: LigneUtilisateur, role: string) {
    const libelle = ROLE_LABELS[role as Role];
    if (!window.confirm(`Donner le rôle « ${libelle} » à ${u.displayName} ?`)) {
      setVersion((v) => v + 1);
      return;
    }
    setRetour(null);
    start(async () => {
      try {
        await changerRole(u.id, role);
        setRetour({ success: `${u.displayName} a maintenant le rôle « ${libelle} ».` });
      } catch {
        setRetour({ error: `Le rôle de ${u.displayName} n'a pas pu être modifié.` });
        setVersion((v) => v + 1);
      }
    });
  }

  function basculer(u: LigneUtilisateur) {
    if (
      u.active &&
      !window.confirm(
        `Désactiver le compte de ${u.displayName} ? La personne ne pourra plus se connecter. Ses inscriptions sont conservées.`,
      )
    ) {
      return;
    }
    setRetour(null);
    start(async () => {
      try {
        await basculerUtilisateur(u.id);
        setRetour({
          success: u.active
            ? `Le compte de ${u.displayName} est désactivé.`
            : `Le compte de ${u.displayName} est réactivé.`,
        });
      } catch {
        setRetour({ error: `Le compte de ${u.displayName} n'a pas pu être modifié.` });
      }
    });
  }

  return (
    <div className="space-y-3">
      <Alert state={retour} />
      <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
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
                <p className="text-xs text-slate-500">
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
                  key={`${u.id}-${version}`}
                  defaultValue={u.role}
                  disabled={u.id === moi || pending}
                  aria-label={`Rôle de ${u.displayName}`}
                  onChange={(e) => modifierRole(u, e.target.value)}
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
                  disabled={u.id === moi || pending}
                  onClick={() => basculer(u)}
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
    </div>
  );
}
