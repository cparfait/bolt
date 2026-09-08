import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { pluriel } from "@/lib/constants";

/**
 * Pagination d'une liste, en liens et non en boutons.
 *
 * Le numéro de page vit dans l'adresse : une page de résultats se met en
 * favori, se rouvre dans un onglet, se transmet par courriel, et le retour
 * arrière du navigateur y ramène. Un compteur gardé en mémoire dans le
 * navigateur perdrait les trois.
 *
 * Les filtres en cours voyagent avec : changer de page ne doit pas remettre la
 * liste à zéro. C'est pourquoi le composant reçoit les paramètres de l'écran
 * plutôt que de les deviner — il tourne côté serveur, où `useSearchParams`
 * n'existe pas.
 */
export function Pagination({
  base,
  params,
  page,
  pages,
  total,
  unite,
}: {
  /** Chemin de l'écran, « /agents ». */
  base: string;
  /** Filtres à conserver d'une page à l'autre. Les valeurs vides sont écartées. */
  params: Record<string, string | undefined>;
  page: number;
  pages: number;
  total: number;
  /** « compte », « séance » — accordé par `pluriel`. */
  unite: string;
}) {
  if (pages <= 1) return null;

  const vers = (n: number) => {
    const p = new URLSearchParams();
    for (const [cle, valeur] of Object.entries(params)) {
      if (valeur) p.set(cle, valeur);
    }
    // La première page ne porte pas de numéro : c'est l'adresse qu'on partage,
    // et « ?page=1 » n'apprend rien à personne.
    if (n > 1) p.set("page", String(n));
    const q = p.toString();
    return q ? `${base}?${q}` : base;
  };

  const lien =
    "inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50";
  const eteint =
    "inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-300";

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
      {/* Le total avant les flèches : « page 2 sur 7 » ne dit pas combien il y
          en a, et c'est la première chose qu'on veut savoir devant une liste
          tronquée. */}
      <p className="text-xs text-slate-400">
        {total} {pluriel(total, unite)} · page {page} sur {pages}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={vers(page - 1)} className={lien} rel="prev">
            <ChevronLeft className="h-4 w-4" /> Précédente
          </Link>
        ) : (
          <span className={eteint} aria-hidden>
            <ChevronLeft className="h-4 w-4" /> Précédente
          </span>
        )}
        {page < pages ? (
          <Link href={vers(page + 1)} className={lien} rel="next">
            Suivante <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <span className={eteint} aria-hidden>
            Suivante <ChevronRight className="h-4 w-4" />
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Numéro de page lu dans l'adresse, et tranche à demander à la base.
 *
 * Bornée des deux côtés : « ?page=0 » et « ?page=abc » ramènent à la première,
 * et une page au-delà de la dernière n'affiche pas une liste vide sans
 * explication — on retombe sur la dernière qui existe.
 */
export function tranche(pageBrute: string | undefined, total: number, parPage: number) {
  const pages = Math.max(1, Math.ceil(total / parPage));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(pageBrute)) || 1));
  return { page, pages, skip: (page - 1) * parPage, take: parPage };
}
