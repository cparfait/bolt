import { Navigation } from "lucide-react";

/**
 * « Itinéraire » : ouvre le GPS du téléphone sur l'adresse du lieu.
 *
 * Un lien et non un bouton — c'est une navigation, et elle part dans une
 * autre application. Rendu seulement quand le lieu a une adresse dans le
 * référentiel : sans elle, il n'y a rien à ouvrir, et un lien mort vaut
 * moins que pas de lien.
 */
export function Itineraire({
  href,
  className = "",
  libelle = "Itinéraire",
}: {
  href: string | null | undefined;
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
      className={`inline-flex items-center gap-1 font-medium text-brand-600 underline-offset-2 hover:underline ${className}`}
    >
      <Navigation className="h-3 w-3 shrink-0" aria-hidden="true" />
      {libelle}
    </a>
  );
}
