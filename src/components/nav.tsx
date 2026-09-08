"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/actions/auth";
import {
  BarChart3,
  CalendarDays,
  LogOut,
  ClipboardCheck,
  Dumbbell,
  Inbox,
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
  // Entrée qui n'a de sens que si la fonction correspondante est activée. Une
  // collectivité qui ne publie pas le formulaire de demande d'accès n'a pas à
  // porter une entrée de navigation vers un écran toujours vide.
  optionnel?: "demandes";
};

// L'ordre compte, et il suit le travail plutôt que l'arborescence : ce qui
// attend une décision d'abord — inscriptions, demandes d'accès —, puis ce qu'on
// consulte au fil de la semaine, puis le référentiel, et enfin ce qu'on règle
// une fois. L'espace personnel reste en dernier, sous son propre intertitre.
const items: Item[] = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
  {
    href: "/inscriptions",
    label: "Inscriptions",
    icon: ClipboardCheck,
    roles: ["ADMIN", "GESTIONNAIRE"],
    groupe: "gestion",
  },
  {
    href: "/agents/demandes",
    label: "Demandes d'accès",
    icon: Inbox,
    roles: ["ADMIN", "GESTIONNAIRE"],
    groupe: "gestion",
    optionnel: "demandes",
  },
  {
    href: "/seances",
    label: "Planning",
    icon: CalendarDays,
    roles: ["ADMIN", "GESTIONNAIRE", "COACH"],
    groupe: "gestion",
  },
  {
    href: "/activites",
    label: "Activités & créneaux",
    icon: Users,
    roles: ["ADMIN", "GESTIONNAIRE"],
    groupe: "gestion",
  },
  // L'entrée existe depuis que /agents est un annuaire et non plus un simple
  // écran de résultats : on n'y parcourt toujours pas 1 200 agents, mais on y
  // répond à « combien de comptes fermés traînent ? » et on y retrouve
  // quelqu'un dont on ne sait plus écrire le nom. La barre du tableau de bord
  // reste le chemin le plus court quand on connaît la personne.
  {
    href: "/agents",
    label: "Agents",
    icon: Users,
    roles: ["ADMIN", "GESTIONNAIRE"],
    groupe: "gestion",
  },
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

/**
 * La marque, en tête des deux barres de navigation.
 *
 * Les écrans d'accueil portaient les logos configurés, la navigation non : elle
 * affichait l'haltère par défaut, y compris chez une collectivité qui avait
 * posé son blason et l'habillage de l'opération en cours. Sur téléphone, où
 * cette barre EST tout l'en-tête, l'application semblait donc n'avoir jamais
 * été personnalisée.
 *
 * Celui de l'opération d'abord, celui de la ville à défaut : même ordre que
 * dans les courriels (src/lib/mail.ts). C'est l'habillage du moment qu'on
 * reconnaît, la ville étant déjà nommée partout ailleurs. Sans aucun logo,
 * l'haltère reprend sa place — une barre sans rien à gauche paraît cassée.
 */
function Marque({ logo, appName }: { logo: string; appName: string }) {
  return (
    <>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URI, next/image ne s'applique pas
        <img
          src={logo}
          alt=""
          className="h-8 w-8 shrink-0 rounded-lg object-contain"
        />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Dumbbell className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0 truncate text-lg font-semibold tracking-tight text-brand-600">
        {appName}
      </span>
    </>
  );
}

function Liens({
  role,
  compteurs,
  demandesActives,
  externe,
  onClick,
}: {
  role: Role;
  compteurs?: Compteurs;
  demandesActives?: boolean;
  externe?: boolean;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const retenus = items.filter(
    (i) =>
      // Depuis Internet, seul l'espace personnel est joignable : `requireUser`
      // refuse les écrans de gestion, et le proxy ne publie même pas leurs
      // chemins. Les afficher offrirait des liens qui ne mènent qu'à une
      // redirection — y compris « Tableau de bord », dont le chemin « / » n'est
      // pas publié.
      (!externe || i.groupe === "personnel") &&
      (!i.roles || i.roles.includes(role) || role === "ADMIN") &&
      // Une entrée optionnelle reste affichée tant qu'il y a des demandes à
      // traiter, même après désactivation du formulaire : sinon la file
      // deviendrait invisible avec ce qu'elle contient encore.
      (i.optionnel !== "demandes" ||
        demandesActives === true ||
        (compteurs?.[i.href] ?? 0) > 0),
  );
  // Le séparateur n'apparaît que si l'utilisateur a réellement les deux
  // casquettes : un agent simple ne voit qu'une liste, sans intertitre inutile.
  const mixte = retenus.some((i) => i.groupe === "gestion");

  /**
   * Un agent qui ne gère rien n'a qu'un seul écran, et donc une seule entrée.
   *
   * Il en avait deux — le tableau de bord et « Mes activités » —, et depuis que
   * les prochaines séances figurent sur les deux, elles racontent la même
   * chose : on choisit entre deux portes qui donnent sur la même pièce. Sur
   * téléphone, où le menu se déplie par-dessus la page, ce choix est un
   * obstacle de plus avant d'arriver quelque part.
   *
   * Le tableau de bord l'emporte : c'est là qu'on atterrit en se connectant, et
   * il mène au catalogue par son propre bouton. « Mes activités » reste
   * atteignable, simplement plus depuis le menu.
   *
   * Sauf depuis Internet, où le tableau de bord n'est pas publié : le menu se
   * retrouverait vide. On garde alors l'entrée personnelle, qui est tout ce
   * qu'il y a.
   */
  const dansLeMenu =
    mixte || !retenus.some((i) => i.href === "/")
      ? retenus
      : retenus.filter((i) => i.groupe !== "personnel");
  const visible = dansLeMenu;
  return (
    <>
      {visible.map((item, index) => {
        const debutPersonnel =
          mixte &&
          item.groupe === "personnel" &&
          visible[index - 1]?.groupe !== "personnel";
        const correspond = (href: string) =>
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        const active =
          correspond(item.href) &&
          !visible.some((a) => a.href !== item.href && a.href.startsWith(item.href) && correspond(a.href));
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

export function Sidebar({
  role,
  compteurs,
  demandesActives,
  externe,
  appName,
  logo,
}: {
  role: Role;
  compteurs?: Compteurs;
  demandesActives?: boolean;
  externe?: boolean;
  appName: string;
  /** Logo de l'opération, celui de la ville à défaut. Vide : l'haltère. */
  logo: string;
}) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex h-14 items-center gap-2.5 border-b border-slate-100 px-5">
        <Marque logo={logo} appName={appName} />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        <Liens
          role={role}
          compteurs={compteurs}
          demandesActives={demandesActives}
          externe={externe}
        />
      </nav>
      <p className="border-t border-slate-100 p-4 text-xs text-slate-400">
        Activités sportives · QVT
      </p>
    </aside>
  );
}

/** Barre de navigation repliable, pour les écrans étroits. */
export function NavMobile({
  role,
  compteurs,
  demandesActives,
  externe,
  appName,
  logo,
  utilisateur,
}: {
  role: Role;
  compteurs?: Compteurs;
  demandesActives?: boolean;
  externe?: boolean;
  appName: string;
  logo: string;
  // Identité et déconnexion vivent ici sur téléphone : l'en-tête qui les
  // portait est masqué sous md, où deux barres empilées mangeaient 112 px de
  // hauteur avant le moindre contenu.
  utilisateur: { nom: string; role: string };
}) {
  const enAttente = Object.values(compteurs ?? {}).reduce((n, v) => n + v, 0);
  return (
    <details className="group border-b border-slate-200 bg-white md:hidden">
      <summary className="flex h-14 cursor-pointer list-none items-center gap-2.5 px-4">
        <Marque logo={logo} appName={appName} />
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
        <Liens
          role={role}
          compteurs={compteurs}
          demandesActives={demandesActives}
          externe={externe}
        />
      </nav>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium leading-tight">
            {utilisateur.nom}
          </p>
          <p className="text-xs leading-tight text-slate-400">{utilisateur.role}</p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
          >
            <LogOut className="h-3.5 w-3.5" />
            Se déconnecter
          </button>
        </form>
      </div>
    </details>
  );
}
