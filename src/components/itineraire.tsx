import { Navigation } from "lucide-react";

/**
 * « Itinéraire » : ouvre le GPS du téléphone sur l'adresse du lieu.
 *
 * Un lien et non un bouton — c'est une navigation, et elle part dans une
 * autre application. Rendu seulement quand le lieu a une adresse dans le
 * référentiel : sans elle, il n'y a rien à ouvrir, et un lien mort vaut
 * moins que pas de lien.
 *
 * En pastille, pas en texte souligné : c'est le seul lien de la ligne et il
 * se vise au pouce, dans un gymnase ou sur un parking. Une pastille se
 * reconnaît d'un coup d'œil et offre une zone de touche réelle ; un mot
 * souligné de la taille du texte, non.
 */
export function Itineraire({
  href,
  className = "bg-brand-50 text-brand-600 hover:bg-brand-100",
  libelle = "Itinéraire",
}: {
  href: string | null | undefined;
  /** Couleurs de la pastille ; à surcharger sur un fond coloré. */
  className?: string;
  libelle?: string;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Ouvrir l'itinéraire dans votre application GPS"
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-semibold leading-5 transition ${className}`}
    >
      <Navigation className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {libelle}
    </a>
  );
}
