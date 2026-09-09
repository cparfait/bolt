import Link from "next/link";
import { etatSaison, type EtatSaison } from "@/lib/saison";

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
 * n'est pas activée (voir `saisonOuverte`, src/lib/saison.ts).
 */
const LIBELLES: Record<EtatSaison, string> = {
  active: "en cours",
  preparation: "en préparation",
  close: "close",
};

export function SelecteurSaison({
  saisons,
  selection,
  base,
  params,
}: {
  saisons: { id: string; nom: string; active: boolean; fin: Date }[];
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
            <span className={courante ? "ml-1.5 opacity-70" : "ml-1.5 text-slate-400"}>
              · {LIBELLES[etat]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Rappel, sous le titre, qu'une saison en préparation n'est vue de personne. */
export function AvertissementPreparation({ saison }: { saison: { active: boolean; fin: Date } }) {
  if (etatSaison(saison) !== "preparation") return null;
  return (
    <p className="mb-6 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
      Saison en préparation : les agents ne la voient pas et ne peuvent pas s&apos;y
      inscrire tant qu&apos;elle n&apos;est pas activée dans Paramètres → Saisons.
    </p>
  );
}
