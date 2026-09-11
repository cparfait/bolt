import { createHmac, timingSafeEqual } from "node:crypto";
import { secretApplicatif } from "./secret";

/**
 * Les liens d'action des courriels — ceux qui portent un bouton.
 *
 * ── Pourquoi une signature, et pas une session ────────────────────────────
 *
 * Prévenir d'une absence, ou rendre une place dont on ne veut plus, n'a de
 * valeur que fait vite : la place profite au suivant de la file, et l'animateur
 * n'attend pas quelqu'un qui ne viendra pas. Or ces courriels se lisent sur un
 * téléphone, souvent hors du réseau de la collectivité, et souvent par ceux-là
 * mêmes qui n'ont pas de poste au bureau — terrain, crèches, gardiennage.
 * Demander de se connecter d'abord, c'est-à-dire de réclamer un lien de
 * connexion, d'attendre un second courriel, puis de retrouver la bonne séance
 * dans une liste, revient à ne rien demander du tout : personne ne prévient, et
 * l'information n'existe jamais.
 *
 * Le lien porte donc son autorisation avec lui. Il ne vaut que pour UN agent et
 * UN objet précis, et n'ouvre aucune session : ce qu'il permet se limite à un
 * geste que l'agent peut de toute façon faire depuis l'application, et que le
 * journal trace.
 *
 * ── Pourquoi aucune table ─────────────────────────────────────────────────
 *
 * Un jeton stocké devrait vivre du moment de l'envoi jusqu'à la séance, et ne
 * servir qu'une fois. Les deux conditions se contredisent : l'agent qui se
 * déclare absent puis se ravise doit pouvoir revenir sur le même lien. Une
 * signature n'a ni durée ni compteur ; c'est l'objet visé qui la périme — une
 * séance passée refuse la déclaration, une place déjà rendue ne se rend pas
 * deux fois.
 *
 * Conséquence assumée : changer SESSION_SECRET invalide les liens en
 * circulation. Ils vivent un jour ou deux, le temps qu'un courriel soit lu.
 *
 * ── Ce que la page fait de la signature ───────────────────────────────────
 *
 * Elle l'affiche, elle n'agit pas. Les passerelles de sécurité des messageries
 * visitent toutes les adresses d'un message avant de le remettre : un lien qui
 * agirait en GET déclarerait l'absence de gens qui n'ont rien ouvert. Le geste
 * demande donc un clic sur la page, et la vérification s'y rejoue — une action
 * serveur n'est pas liée au chemin qui l'affiche (voir src/proxy.ts).
 */

/**
 * 32 caractères base64url, soit 192 bits de HMAC-SHA256. Tronquer une empreinte
 * ne l'affaiblit que de ce qu'on en retire : il reste de quoi rendre la
 * fabrication d'un lien valide hors d'atteinte, et l'adresse tient sur une
 * ligne dans un client de messagerie qui la coupe.
 */
const LONGUEUR = 32;

/**
 * Le préfixe d'usage cantonne la signature à son emploi : le même secret sert
 * ailleurs, et deux messages signés doivent rester distincts même si leurs
 * parties venaient à se ressembler.
 */
type Usage = "absence" | "place";

function signer(usage: Usage, parties: string[]): string {
  return createHmac("sha256", secretApplicatif())
    .update([usage, ...parties].join(":"))
    .digest("base64url")
    .slice(0, LONGUEUR);
}

function verifier(usage: Usage, parties: string[], fournie: string | undefined): boolean {
  const attendue = Buffer.from(signer(usage, parties));
  const recue = Buffer.from(fournie ?? "");
  // `timingSafeEqual` exige deux tampons de même taille, et comparer les
  // longueurs ne révèle rien : celle-ci est une constante du programme.
  if (attendue.length !== recue.length) return false;
  return timingSafeEqual(attendue, recue);
}

// ── « Je ne pourrai pas venir » — rappel de séance ──────────────────────────

export function signatureAbsence(seanceId: string, userId: string): string {
  return signer("absence", [seanceId, userId]);
}

export function absenceAutorisee(
  seanceId: string,
  userId: string,
  signature: string | undefined,
): boolean {
  return verifier("absence", [seanceId, userId], signature);
}

// ── « Je laisse ma place » — promotion depuis la liste d'attente ────────────

/**
 * Une inscription telle que le lien la désigne : son identifiant, et le moment
 * de la promotion qu'il concerne.
 *
 * L'identifiant seul ne suffit pas : une inscription est REUTILISÉE quand
 * l'agent se réinscrit après un désistement (voir `demanderInscription`,
 * src/lib/inscriptions.ts). Signé sur le seul identifiant, le lien reçu à une
 * première promotion restait valable à la suivante, des mois plus tard — et
 * un vieux courriel rendait une place qu'on venait de reprendre. `promuAt`
 * est réécrit à chaque promotion et remis à zéro à chaque réinscription : le
 * lien ne vaut que pour LA promotion qui l'a fait envoyer.
 */
export type InscriptionPromue = { id: string; promuAt: Date | null };

export function signaturePlace(inscription: InscriptionPromue): string {
  return signer("place", partiesPlace(inscription));
}

/**
 * Vérification contre l'inscription RECHARGÉE, jamais contre ce que porte le
 * formulaire : c'est l'état actuel de l'inscription qui décide, et une
 * inscription jamais promue (`promuAt` nul) n'a aucun lien valide.
 */
export function placeAutorisee(
  inscription: InscriptionPromue,
  signature: string | undefined,
): boolean {
  if (inscription.promuAt === null) return false;
  return verifier("place", partiesPlace(inscription), signature);
}

function partiesPlace(inscription: InscriptionPromue): string[] {
  return [inscription.id, inscription.promuAt?.toISOString() ?? ""];
}

// ── Adresses ────────────────────────────────────────────────────────────────

/**
 * `base` est l'URL publique — la même que celle des liens d'émargement : ces
 * pages sont joignables depuis Internet, précisément parce que les courriels
 * qui les portent s'y lisent.
 */
function racine(base: string): string {
  return base.replace(/\/+$/, "");
}

export function lienAbsence(seanceId: string, userId: string, base: string): string {
  return `${racine(base)}/courriel/absence/${seanceId}/${userId}/${signatureAbsence(seanceId, userId)}`;
}

export function lienPlace(inscription: InscriptionPromue, base: string): string {
  return `${racine(base)}/courriel/place/${inscription.id}/${signaturePlace(inscription)}`;
}
