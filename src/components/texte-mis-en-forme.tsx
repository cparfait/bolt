import { Fragment } from "react";
import { analyserMarkup, type Segment } from "@/lib/markup";

/**
 * Rendu d'un texte au format `src/lib/markup.ts`.
 *
 * Construit des éléments React à partir des segments analysés — jamais de
 * `dangerouslySetInnerHTML`. C'est ce qui rend la saisie libre sans danger :
 * quoi qu'un gestionnaire colle dans le champ, balises comprises, cela ne peut
 * ressortir que comme du texte.
 */
function Segments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) => {
        let contenu = <Fragment key={i}>{s.texte}</Fragment>;
        if (s.souligne) contenu = <u key={i}>{contenu}</u>;
        if (s.gras)
          contenu = (
            <strong key={i} className="font-semibold text-slate-900">
              {contenu}
            </strong>
          );
        return contenu;
      })}
    </>
  );
}

export function TexteMisEnForme({
  texte,
  className = "",
}: {
  texte: string;
  /** Classes portées par chaque paragraphe et chaque liste. */
  className?: string;
}) {
  const blocs = analyserMarkup(texte);
  if (blocs.length === 0) return null;

  return (
    <>
      {blocs.map((bloc, i) =>
        bloc.type === "paragraphe" ? (
          <p key={i} className={`${className} ${i > 0 ? "mt-2" : ""}`.trim()}>
            <Segments segments={bloc.segments} />
          </p>
        ) : (
          <ul
            key={i}
            className={`${className} ${i > 0 ? "mt-2" : ""} list-disc space-y-1 pl-5`.trim()}
          >
            {bloc.items.map((item, j) => (
              <li key={j}>
                <Segments segments={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </>
  );
}

/**
 * Même rendu, sur une seule ligne : pas de `<p>`, donc utilisable à
 * l'intérieur d'un libellé de case à cocher. Les listes y sont aplaties.
 */
export function TexteEnLigne({ texte }: { texte: string }) {
  const blocs = analyserMarkup(texte);
  return (
    <>
      {blocs.map((bloc, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          {bloc.type === "paragraphe" ? (
            <Segments segments={bloc.segments} />
          ) : (
            bloc.items.map((item, j) => (
              <Fragment key={j}>
                {j > 0 && " · "}
                <Segments segments={item} />
              </Fragment>
            ))
          )}
        </Fragment>
      ))}
    </>
  );
}
