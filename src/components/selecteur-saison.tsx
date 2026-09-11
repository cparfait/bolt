import Link from "next/link";
import { LIBELLES_ETAT_SAISON, etatSaison } from "@/lib/saison";

/** Ce qu'un écran doit connaître d'une saison pour la nommer et la situer. */
export type SaisonChoix = { id: string; nom: string; active: boolean; debut: Date; fin: Date };

/**
 * Choix de la saison sur laquelle on travaille, dans les écrans du service.
 *
 * Des liens, pas un état : la saison choisie est dans l'adresse, donc
 * conservée au rechargement et d'une page à l'autre. N'apparaît que s'il y a
 * un choix à faire — une seule saison n'a pas besoin de sélecteur.
 *
 * L'état accompagne le nom, parce que c'est lui qui répond à la question que
 * le service se pose en préparant la rentrée : « est-ce que les agents voient
 * déjà ça ? » Une saison en préparation ne leur est pas montrée tant qu'elle
 * n'est pas activée (voir `saisonOuverte`, src/lib/saison.ts) — et une saison
 * commencée sans avoir été activée non plus, ce que son libellé dit en clair.
 */
export function SelecteurSaison({
  saisons,
  selection,
  base,
  params,
}: {
  saisons: SaisonChoix[];
  selection: string;
  base: string;
  /** Autres paramètres à conserver dans le lien. */
  params?: Record<string, string | undefined>;
}) {
  if (saisons.length < 2) return null;

  const lien = (id: string) => {
    const q = new URLSearchParams();
    for (const [cle, valeur] of Object.entries(params ?? {})) if (valeur) q.set(cle, valeur);
    q.set("saison", id);
    return `${base}?${q.toString()}`;
  };

  return (
    <nav aria-label="Saison" className="flex flex-wrap items-center gap-1.5">
      {saisons.map((s) => {
        const etat = etatSaison(s);
        const courante = s.id === selection;
        return (
          <Link
            key={s.id}
            href={lien(s.id)}
            aria-current={courante ? "true" : undefined}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              courante
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {s.nom}
            <span className={courante ? "ml-1.5 opacity-70" : "ml-1.5 text-slate-500"}>
              · {LIBELLES_ETAT_SAISON[etat]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Rappel, sous le titre, que la saison affichée n'est pas celle des agents.
 *
 * Sur tous les écrans qui suivent la saison choisie, pas seulement les
 * activités : un service qui arbitre des inscriptions ou lit un planning sur
 * la mauvaise saison doit le voir avant d'agir, pas en cherchant pourquoi la
 * liste ne correspond pas à ce que les agents lui décrivent.
 */
export function AvertissementPreparation({
  saison,
}: {
  saison: { active: boolean; debut: Date; fin: Date };
}) {
  const etat = etatSaison(saison);
  if (etat === "active") return null;
  const texte =
    etat === "preparation"
      ? "Saison en préparation : les agents ne la voient pas et ne peuvent pas s'y inscrire tant qu'elle n'est pas activée dans Paramètres → Saisons."
      : etat === "encours"
        ? "Cette saison a commencé mais n'est pas activée : les agents ne la voient pas et ne peuvent pas s'y inscrire. Activez-la dans Paramètres → Saisons si c'est bien celle qui tourne."
        : "Saison close : ce que vous voyez ici est de l'historique. Les agents travaillent sur la saison activée.";
  const couleur =
    etat === "close"
      ? "border-slate-200 bg-slate-50 text-slate-700"
      : etat === "encours"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-sky-200 bg-sky-50 text-sky-900";
  return <p className={`mb-6 rounded-xl border px-4 py-3 text-sm ${couleur}`}>{texte}</p>;
}
