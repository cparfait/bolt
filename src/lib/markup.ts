/**
 * Mise en forme des textes saisis dans l'application : gras, souligné, puces.
 *
 * Volontairement PAS du HTML. Les déclarations et les mentions d'information
 * sont saisies par le service des sports depuis un navigateur, et affichées
 * ensuite à tous les agents : accepter du HTML obligerait à le désinfecter, et
 * un désinfectant écrit à la main est un trou de sécurité qui attend son tour.
 * Ici, la source ne peut rien exprimer d'autre que ces trois marques, et le
 * rendu construit des éléments React — jamais de `dangerouslySetInnerHTML`. Une
 * balise `<script>` collée dans le champ ressort donc affichée telle quelle.
 *
 * La syntaxe est celle que les gens ont déjà vue ailleurs :
 *
 *   **gras**            __souligné__
 *   - une puce          (une ligne par puce)
 *   une ligne vide sépare deux paragraphes
 *
 * Les marques non refermées restent du texte : mieux vaut une étoile visible
 * qu'un paragraphe qui disparaît.
 */

export type Segment = {
  texte: string;
  gras?: boolean;
  souligne?: boolean;
};

export type Bloc =
  | { type: "paragraphe"; segments: Segment[] }
  | { type: "liste"; items: Segment[][] };

const GRAS = "**";
const SOULIGNE = "__";

/** Une ligne de puce : « - texte » ou « * texte ». */
const PUCE = /^\s*[-*]\s+(.*)$/;

/**
 * Découpe une ligne en segments selon les marques de gras et de souligné.
 * Les deux se combinent : `**__ainsi__**` donne un segment gras et souligné.
 */
export function analyserInline(ligne: string): Segment[] {
  const segments: Segment[] = [];

  function ajouter(texte: string, gras: boolean, souligne: boolean) {
    if (!texte) return;
    // Deux marques identiques qui se suivent produiraient deux segments
    // jumeaux : on les recolle pour garder un rendu compact.
    const dernier = segments[segments.length - 1];
    if (dernier && !!dernier.gras === gras && !!dernier.souligne === souligne) {
      dernier.texte += texte;
      return;
    }
    segments.push({ texte, ...(gras && { gras: true }), ...(souligne && { souligne: true }) });
  }

  function parcourir(source: string, gras: boolean, souligne: boolean) {
    let i = 0;
    let litteral = "";
    while (i < source.length) {
      const marque =
        source.startsWith(GRAS, i) && !gras
          ? GRAS
          : source.startsWith(SOULIGNE, i) && !souligne
            ? SOULIGNE
            : null;
      if (!marque) {
        litteral += source[i];
        i += 1;
        continue;
      }
      const fin = source.indexOf(marque, i + marque.length);
      if (fin === -1) {
        // Marque jamais refermée : elle ne vaut rien, on la garde telle quelle.
        litteral += marque;
        i += marque.length;
        continue;
      }
      ajouter(litteral, gras, souligne);
      litteral = "";
      parcourir(
        source.slice(i + marque.length, fin),
        gras || marque === GRAS,
        souligne || marque === SOULIGNE,
      );
      i = fin + marque.length;
    }
    ajouter(litteral, gras, souligne);
  }

  parcourir(ligne, false, false);
  return segments;
}

/**
 * Découpe un texte en paragraphes et listes à puces.
 * Les lignes consécutives d'un même paragraphe sont recollées par un espace :
 * un retour à la ligne isolé sert à écrire confortablement, pas à mettre en
 * page. C'est la ligne vide qui sépare deux paragraphes.
 */
export function analyserMarkup(source: string): Bloc[] {
  const blocs: Bloc[] = [];
  let paragraphe: string[] = [];
  let items: string[] = [];

  const cloreParagraphe = () => {
    if (paragraphe.length === 0) return;
    blocs.push({ type: "paragraphe", segments: analyserInline(paragraphe.join(" ")) });
    paragraphe = [];
  };
  const cloreListe = () => {
    if (items.length === 0) return;
    blocs.push({ type: "liste", items: items.map(analyserInline) });
    items = [];
  };

  for (const ligne of (source ?? "").split(/\r?\n/)) {
    const puce = ligne.match(PUCE);
    if (puce) {
      cloreParagraphe();
      items.push(puce[1].trim());
      continue;
    }
    if (ligne.trim() === "") {
      cloreParagraphe();
      cloreListe();
      continue;
    }
    cloreListe();
    paragraphe.push(ligne.trim());
  }
  cloreParagraphe();
  cloreListe();
  return blocs;
}

/**
 * Le texte nu, marques retirées.
 *
 * Sert là où la mise en forme n'a pas sa place : l'objet d'un courriel, un
 * message d'erreur, un export. Un `**` qui traînerait dans un sujet de mail
 * ferait amateur.
 */
export function texteBrut(source: string): string {
  return analyserMarkup(source)
    .flatMap((b) =>
      b.type === "paragraphe"
        ? [b.segments.map((s) => s.texte).join("")]
        : b.items.map((i) => i.map((s) => s.texte).join("")),
    )
    .join(" ")
    .trim();
}

/**
 * Les premiers mots d'un texte, pour le désigner sans le citer en entier.
 *
 * Prend l'amorce en gras si elle existe — sur les déclarations, elle est
 * précisément là pour ça (« Je certifie », « Je m'engage ») — et retombe sinon
 * sur les premiers mots.
 */
export function amorceDe(source: string, longueurMax = 40): string {
  const blocs = analyserMarkup(source);
  const premier = blocs[0];
  const segments = premier
    ? premier.type === "paragraphe"
      ? premier.segments
      : (premier.items[0] ?? [])
    : [];

  const gras = segments.find((s) => s.gras)?.texte.trim();
  if (gras) return gras;

  const brut = texteBrut(source);
  if (brut.length <= longueurMax) return brut;
  const coupe = brut.slice(0, longueurMax);
  const espace = coupe.lastIndexOf(" ");
  return `${(espace > 0 ? coupe.slice(0, espace) : coupe).trimEnd()}…`;
}
