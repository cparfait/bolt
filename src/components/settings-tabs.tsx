"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const onglets = [
  { href: "/parametres", label: "Général" },
  { href: "/parametres/saisons", label: "Saisons & calendrier" },
  { href: "/parametres/lieux", label: "Lieux" },
  { href: "/parametres/annuaire", label: "Annuaire (LDAPS)", adminSeul: true },
  { href: "/parametres/messagerie", label: "Messagerie", adminSeul: true },
  { href: "/parametres/utilisateurs", label: "Comptes & rôles", adminSeul: true },
  { href: "/parametres/journal", label: "Journal", adminSeul: true },
];

export function OngletsParametres({ estAdmin }: { estAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-px">
      {onglets
        .filter((o) => estAdmin || !o.adminSeul)
        .map((o) => {
        const actif =
          o.href === "/parametres" ? pathname === o.href : pathname.startsWith(o.href);
        return (
          <Link
            key={o.href}
            href={o.href}
            className={`rounded-t-lg border-b-2 px-3.5 py-2 text-sm font-medium transition ${
              actif
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
