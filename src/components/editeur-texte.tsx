"use client";

import { useId, useRef, useState } from "react";
import { Bold, List, Underline } from "lucide-react";
import { TexteMisEnForme } from "@/components/texte-mis-en-forme";

/**
 * Éditeur des textes légaux : gras, souligné, puces.
 *
 * Une zone de saisie et une barre d'outils, pas un éditeur WYSIWYG. Le choix
 * est délibéré : un WYSIWYG produit du HTML, qu'il faudrait ensuite désinfecter
 * avant de l'afficher à tous les agents — et un désinfectant écrit à la main
 * est un trou de sécurité qui attend son tour. Ici la saisie ne peut exprimer
 * que trois mises en forme, et l'aperçu affiché sous le champ montre en
 * permanence le rendu exact que verra l'agent : on ne perd donc pas grand-chose
 * du « ce que je vois est ce que j'obtiens ».
 */
export function EditeurTexte({
  name,
  defaultValue,
  label,
  aide,
  lignes = 4,
}: {
  name: string;
  defaultValue: string;
  label?: string;
  aide?: string;
  lignes?: number;
}) {
  const [valeur, setValeur] = useState(defaultValue);
  const zone = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  /** Entoure la sélection des marques demandées, ou les insère au curseur. */
  function entourer(marque: string) {
    const el = zone.current;
    if (!el) return;
    const { selectionStart: debut, selectionEnd: fin } = el;
    const choisi = valeur.slice(debut, fin);
    const suivant = `${valeur.slice(0, debut)}${marque}${choisi}${marque}${valeur.slice(fin)}`;
    setValeur(suivant);
    // Le curseur revient dans le texte marqué, pas après : on vient
    // probablement de mettre en gras pour continuer à écrire.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(debut + marque.length, fin + marque.length);
    });
  }

  /** Passe chaque ligne de la sélection en puce, ou la ligne courante. */
  function enPuces() {
    const el = zone.current;
    if (!el) return;
    const { selectionStart: debut, selectionEnd: fin } = el;
    const debutLigne = valeur.lastIndexOf("\n", debut - 1) + 1;
    const finLigne = valeur.indexOf("\n", fin) === -1 ? valeur.length : valeur.indexOf("\n", fin);
    const lignesChoisies = valeur.slice(debutLigne, finLigne).split("\n");
    // Toutes déjà en puces : le bouton les retire, comme partout ailleurs.
    const toutesEnPuces = lignesChoisies.every((l) => /^\s*[-*]\s+/.test(l));
    const transformees = lignesChoisies.map((l) =>
      toutesEnPuces ? l.replace(/^\s*[-*]\s+/, "") : l.trim() ? `- ${l.trim()}` : l,
    );
    const suivant =
      valeur.slice(0, debutLigne) + transformees.join("\n") + valeur.slice(finLigne);
    setValeur(suivant);
    requestAnimationFrame(() => el.focus());
  }

  const bouton =
    "inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700";

  return (
    <div>
      {label && (
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
          {label}
        </label>
      )}

      <div className="flex items-center gap-1 pb-1.5">
        <button type="button" onClick={() => entourer("**")} className={bouton} title="Gras">
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => entourer("__")}
          className={bouton}
          title="Souligné"
        >
          <Underline className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={enPuces} className={bouton} title="Liste à puces">
          <List className="h-3.5 w-3.5" />
        </button>
        <span className="ml-1 text-[11px] text-slate-400">
          **gras** · __souligné__ · « - » en début de ligne pour une puce
        </span>
      </div>

      <textarea
        id={id}
        ref={zone}
        name={name}
        rows={lignes}
        value={valeur}
        onChange={(e) => setValeur(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs leading-relaxed outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />

      {aide && <p className="mt-1 text-[11px] text-slate-400">{aide}</p>}

      <div className="mt-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-3">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          Aperçu
        </p>
        {valeur.trim() ? (
          <TexteMisEnForme texte={valeur} className="text-xs leading-relaxed text-slate-600" />
        ) : (
          <p className="text-xs italic text-slate-400">vide</p>
        )}
      </div>
    </div>
  );
}
