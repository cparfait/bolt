"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  Dumbbell,
  LayoutDashboard,
  Settings,
  UserCheck,
  Users,
} from "lucide-react";
import type { Role } from "@prisma/client";

type Item = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: Role[]; // absent = visible par tous
  // « personnel » = l'espace de l'utilisateur en tant qu'agent pratiquant,
  // séparé des écrans de gestion. Sans cette distinction, le service des sports
  // voit « Mes activités » au milieu de ses outils et ne sait pas de quoi il
  // s'agit.
  groupe?: "gestion" | "personnel";
  // Libellé employé lorsque l'utilisateur a aussi des écrans de gestion :
  // « Mes activités » y serait ambigu au milieu des outils du service.
  labelMixte?: string;
};

// L'ordre compte : les écrans de gestion d'abord, l'espace personnel en
// dernier, sous son propre intertitre.
const items: Item[] = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
  {
    href: "/seances",
    label: "Planning",
    icon: CalendarDays,
    roles: ["ADMIN", "GESTIONNAIRE", "COACH"],
    groupe: "gestion",
  },
  {
    href: "/inscriptions",
    label: "Inscriptions",
    icon: ClipboardCheck,
    roles: ["ADMIN", "GESTIONNAIRE"],
    groupe: "gestion",
  },
  {
    href: "/activites",
    label: "Activités & créneaux",
    icon: Users,
    roles: ["ADMIN", "GESTIONNAIRE"],
    groupe: "gestion",
  },
  // Pas d'entrée « Agents » : on ne parcourt pas les 1 200 agents d'une
  // collectivité, on en cherche un. La barre du tableau de bord suggère dès
  // deux lettres et mène directement à la fiche ; /agents reste servie pour les
  // résultats complets et les fiches individuelles.
  {
    href: "/animateurs",
    label: "Animateurs",
    icon: UserCheck,
    roles: ["ADMIN", "GESTIONNAIRE"],
    groupe: "gestion",
  },
  {
    href: "/statistiques",
    label: "Statistiques",
    icon: BarChart3,
    roles: ["ADMIN", "GESTIONNAIRE"],
    groupe: "gestion",
  },
  {
    href: "/parametres",
    label: "Paramètres",
    icon: Settings,
    roles: ["ADMIN", "GESTIONNAIRE"],
    groupe: "gestion",
  },
  {
    href: "/mes-activites",
    label: "Mes activités",
    labelMixte: "M'inscrire à une activité",
    icon: Dumbbell,
    groupe: "personnel",
  },
];

/** Nombre d'éléments en attente par écran, indexé par lien. */
export type Compteurs = Record<string, number>;

function Liens({
  role,
  compteurs,
  onClick,
}: {
  role: Role;
  compteurs?: Compteurs;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const visible = items.filter((i) => !i.roles || i.roles.includes(role) || role === "ADMIN");
  // Le séparateur n'apparaît que si l'utilisateur a réellement les deux
  // casquettes : un agent simple ne voit qu'une liste, sans intertitre inutile.
  const mixte = visible.some((i) => i.groupe === "gestion");
  return (
    <>
      {visible.map((item, index) => {
        const debutPersonnel =
          mixte &&
          item.groupe === "personnel" &&
          visible[index - 1]?.groupe !== "personnel";
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        // Ce qui attend une décision se voit depuis n'importe quel écran :
        // sans cela, une demande d'inscription peut dormir des jours.
        const enAttente = compteurs?.[item.href] ?? 0;
        return (
          <div key={item.href}>
            {debutPersonnel && (
              <p className="mb-1 mt-4 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Ma pratique sportive
              </p>
            )}
          <Link
            href={item.href}
            onClick={onClick}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-brand-50 text-brand-700"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">
              {mixte && item.labelMixte ? item.labelMixte : item.label}
            </span>
            {enAttente > 0 && (
              <span
                className="ml-auto shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-700"
                title={`${enAttente} en attente de décision`}
              >
                {enAttente}
              </span>
            )}
          </Link>
          </div>
        );
      })}
    </>
  );
}

export function Sidebar({ role, compteurs }: { role: Role; compteurs?: Compteurs }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex h-14 items-center gap-2.5 border-b border-slate-100 px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Dumbbell className="h-4 w-4" />
        </span>
        <span className="text-lg font-semibold tracking-tight">Bolt</span>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        <Liens role={role} compteurs={compteurs} />
      </nav>
      <p className="border-t border-slate-100 p-4 text-xs text-slate-400">
        Activités sportives · QVT
      </p>
    </aside>
  );
}

/** Barre de navigation repliable, pour les écrans étroits. */
export function NavMobile({ role, compteurs }: { role: Role; compteurs?: Compteurs }) {
  const enAttente = Object.values(compteurs ?? {}).reduce((n, v) => n + v, 0);
  return (
    <details className="group border-b border-slate-200 bg-white md:hidden">
      <summary className="flex h-14 cursor-pointer list-none items-center gap-2.5 px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Dumbbell className="h-4 w-4" />
        </span>
        <span className="text-lg font-semibold tracking-tight">Bolt</span>
        {/* Menu replié : le total en attente reste visible, sinon l'alerte
            disparaîtrait complètement sur téléphone. */}
        {enAttente > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-700 group-open:hidden">
            {enAttente}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-400 group-open:hidden">Menu</span>
        <span className="ml-auto hidden text-xs text-slate-400 group-open:inline">Fermer</span>
      </summary>
      <nav className="space-y-0.5 p-3 pt-0">
        <Liens role={role} compteurs={compteurs} />
      </nav>
    </details>
  );
}
