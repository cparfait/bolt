"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Formulaire de filtrage qui s'applique dès qu'un choix change.
 *
 * Le bouton « Afficher » n'apportait rien : le filtre tient en un geste, et
 * l'oublier laissait l'écran sur des données qui ne correspondaient plus au
 * menu affiché — le pire des deux états. La sélection reste dans l'URL, donc
 * partageable et conservée au retour arrière.
 *
 * Le déclenchement suit la nature du champ : un menu ou une case s'applique au
 * clic, une date dès qu'elle est complète, un champ libre à la sortie du champ.
 * Sans cette distinction, chaque frappe déclencherait une navigation.
 */
export function FiltreForm({
  children,
  className = "flex flex-wrap items-center gap-2",
}: {
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const chemin = usePathname();

  /** Comparaison indépendante de l'ordre des paramètres. */
  const signature = (p: URLSearchParams) =>
    [...p.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("&");

  const appliquer = (form: HTMLFormElement) => {
    const params = new URLSearchParams();
    for (const [cle, valeur] of new FormData(form)) {
      // Les valeurs vides — « toutes les activités » — sont retirées de l'URL
      // plutôt que d'y laisser un paramètre sans effet.
      if (typeof valeur === "string" && valeur !== "") params.set(cle, valeur);
    }
    // Comparé à l'URL courante : passer dans un champ sans rien changer ne doit
    // pas relancer de navigation.
    const enCours = new URLSearchParams(window.location.search);
    if (signature(params) === signature(enCours)) return;
    const requete = params.toString();
    router.push(requete ? `${chemin}?${requete}` : chemin);
  };

  const immediat = (cible: EventTarget | null) => {
    if (cible instanceof HTMLSelectElement) return true;
    if (!(cible instanceof HTMLInputElement)) return false;
    if (cible.type === "checkbox" || cible.type === "radio") return true;
    // Une date reste vide tant que le navigateur n'a pas les trois parties :
    // une valeur non vide est donc une saisie terminée.
    return cible.type === "date" && cible.value !== "";
  };

  return (
    <form
      className={className}
      onChange={(e) => {
        if (immediat(e.target)) appliquer(e.currentTarget);
      }}
      onBlur={(e) => {
        if (e.target instanceof HTMLInputElement && !immediat(e.target)) {
          appliquer(e.currentTarget);
        }
      }}
      onSubmit={(e) => {
        // Entrée dans un champ : on applique sans recharger toute la page.
        e.preventDefault();
        appliquer(e.currentTarget);
      }}
    >
      {children}
    </form>
  );
}
