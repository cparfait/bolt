import nodemailer from "nodemailer";
import { dimensionsImage, redimensionner } from "./images";
import {
  getGeneralSettings,
  getSmtpSettings,
  urlEspaceAgent,
  type GeneralSettings,
  type SmtpSettings,
} from "./settings";

export type MailResult = {
  ok: boolean;
  message: string;
  /**
   * Sur un échec : la messagerie a-t-elle refusé **ce destinataire**, ou
   * a-t-elle refusé de servir tout court ? Une adresse inconnue est rejetée
   * pour elle-même, la retenter ne changerait rien. Un plafond de débit, une
   * authentification refusée, un réseau coupé valent pour tous les messages
   * suivants — celui qui a échoué reste à faire, plus tard.
   */
  destinataireRefuse?: boolean;
};

/**
 * Nombre de messages qu'une campagne accepte de soumettre par minute.
 *
 * C'est le plafond de Microsoft 365 en soumission SMTP authentifiée (trente
 * par boîte et par minute), avec une marge pour sa fenêtre glissante. Une
 * boucle sans cadence passait ce cap en quelques secondes : à partir du
 * trente-et-unième, chaque message était refusé (« 4.4.2 message submission
 * rate exceeded ») sans qu'aucun envoi ne s'arrête. Pour un relais interne
 * sans plafond, la cadence ne coûte que du temps : trois cents messages en
 * douze minutes, pendant lesquelles l'application sert ses pages comme
 * d'habitude.
 */
export const MESSAGES_PAR_MINUTE = 25;

/**
 * Une messagerie ouverte pour une série d'envois : même connexion, réglages
 * et logo lus une fois, débit borné. À refermer avec `fermer()`.
 */
export type Messagerie = {
  envoyer(to: string, subject: string, corps: string): Promise<MailResult>;
  fermer(): void;
};

/** Envoi isolé — une relance, une notification. Ouvre et referme aussitôt. */
export async function envoyerMail(
  to: string,
  subject: string,
  corps: string,
): Promise<MailResult> {
  const m = await ouvrirMessagerie({ cadencer: false });
  try {
    return await m.envoyer(to, subject, corps);
  } finally {
    m.fermer();
  }
}

/**
 * Prépare une messagerie. Volontairement tolérante : une relance ou une
 * notification qui ne part pas ne doit jamais faire échouer l'action métier
 * correspondante (valider une inscription, clôturer une séance) — les échecs
 * reviennent en résultat, jamais en exception.
 *
 * `cadencer` : file les messages dans une connexion unique en respectant
 * `MESSAGES_PAR_MINUTE`. C'est le mode d'une campagne ; un envoi isolé s'en
 * passe et n'attend pas.
 */
export async function ouvrirMessagerie(
  { cadencer = true }: { cadencer?: boolean } = {},
): Promise<Messagerie> {
  const smtp = await getSmtpSettings();
  if (!smtp?.host || !smtp?.from) {
    return {
      envoyer: async () => ({
        ok: false,
        message: "Messagerie non configurée (Paramètres → Messagerie).",
      }),
      fermer: () => {},
    };
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 25,
    secure: Boolean(smtp.secure),
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? "" } : undefined,
    tls: { rejectUnauthorized: smtp.tlsRejectUnauthorized !== false },
    ...(cadencer
      ? { pool: true, maxConnections: 1, rateDelta: 60_000, rateLimit: MESSAGES_PAR_MINUTE }
      : {}),
  });

  const g = await getGeneralSettings();
  // Le logo voyage en pièce jointe inline (référencée par `cid:`) : la plupart
  // des messageries ignorent les images en data URI dans le HTML — Gmail les
  // retire purement et simplement.
  // Le logo de l'opération, celui de la ville à défaut : un courriel porte
  // déjà le nom de l'application dans son en-tête, et c'est l'habillage en
  // cours qu'on y reconnaît.
  const logo = logoPourMail(g.logo || g.logoVille);
  const origines = originesAutorisees(g);

  return {
    async envoyer(to, subject, corps) {
      if (!to) return { ok: false, message: "Destinataire sans adresse e-mail." };
      try {
        await transport.sendMail({
          from: smtp.from,
          to,
          subject,
          text: sansNotation(corps, origines),
          html: gabarit(subject, corps, logo, g.appName, g.appDescription, g.orgName, origines),
          attachments: logo
            ? [
                {
                  filename: `logo.${logo.extension}`,
                  content: logo.contenu,
                  contentType: logo.mime,
                  cid: CID_LOGO,
                  contentDisposition: "inline",
                },
              ]
            : undefined,
        });
        return { ok: true, message: `Message envoyé à ${to}.` };
      } catch (e) {
        return { ok: false, message: expliquer(e, smtp), destinataireRefuse: destinataireRefuse(e) };
      }
    },
    fermer: () => transport.close(),
  };
}

/**
 * L'échec vient-il du destinataire lui-même ? Nodemailer marque `EENVELOPE`
 * les refus prononcés sur l'enveloppe (MAIL FROM, RCPT TO) ; avec un code
 * 5xx, c'est un rejet définitif de l'adresse — inconnue, désactivée,
 * interdite. Tout le reste (débit dépassé en 4xx, authentification, réseau,
 * message refusé au DATA) vaut pour la messagerie entière et se retente.
 */
export function destinataireRefuse(e: unknown): boolean {
  const err = e as { code?: unknown; responseCode?: unknown } | null;
  return (
    typeof err === "object" &&
    err !== null &&
    err.code === "EENVELOPE" &&
    typeof err.responseCode === "number" &&
    err.responseCode >= 500 &&
    err.responseCode < 600
  );
}

const CID_LOGO = "logo-bolt";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Hauteur d'affichage du logo dans le courriel, en pixels. */
export const HAUTEUR_LOGO_MAIL = 44;

export type LogoMail = {
  contenu: Buffer;
  mime: string;
  extension: string;
  /**
   * Dimensions d'affichage, posées en **attributs HTML** et pas seulement en
   * CSS : Outlook rend le message avec le moteur de Word, qui ignore
   * `max-width` et `max-height`. Un logo de 1200 px s'y affichait donc à
   * 1200 px et chassait le texte du message hors de l'écran — défaut
   * invisible partout ailleurs, les autres messageries respectant le CSS.
   *
   * `null` quand les dimensions n'ont pas pu être lues : le gabarit retombe
   * alors sur le seul attribut `height`, que ce moteur respecte aussi.
   */
  largeur: number | null;
  hauteur: number | null;
};

/**
 * Prépare le logo configuré pour l'envoi en pièce jointe inline.
 * Formats matriciels uniquement : le SVG n'est pas affiché par Gmail ni
 * Outlook, même en pièce jointe — un logo SVG laisse le mail sans image
 * plutôt que d'y glisser une icône cassée.
 */
function logoPourMail(dataUri: string): LogoMail | null {
  const m = dataUri.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!m) return null;
  const contenu = Buffer.from(m[2], "base64");
  const taille = redimensionner(dimensionsImage(contenu), HAUTEUR_LOGO_MAIL);
  return {
    contenu,
    mime: m[1],
    extension: EXTENSIONS[m[1]],
    largeur: taille?.largeur ?? null,
    hauteur: taille?.hauteur ?? null,
  };
}

/**
 * Traduit les échecs SMTP courants en conseil actionnable.
 *
 * Les messages d'OpenSSL et de nodemailer sont exacts mais illisibles ; or
 * c'est presque toujours la même poignée de causes — mauvais mode TLS, port
 * fermé, certificat interne, authentification refusée.
 */
function expliquer(e: unknown, smtp: SmtpSettings): string {
  const brut = e instanceof Error ? e.message : String(e);
  const b = brut.toLowerCase();

  if (b.includes("wrong version number")) {
    return smtp.secure
      ? `Le serveur ${smtp.host}:${smtp.port} n'attend pas de TLS dès la connexion. Décochez « Connexion TLS implicite » : le port ${smtp.port} utilise vraisemblablement STARTTLS. (${brut})`
      : `Le serveur ${smtp.host}:${smtp.port} semble exiger du TLS dès la connexion. Cochez « Connexion TLS implicite », généralement avec le port 465. (${brut})`;
  }
  if (b.includes("self-signed") || b.includes("self signed") || b.includes("unable to verify")) {
    return `Le certificat de ${smtp.host} n'est pas vérifiable (autorité interne). Décochez « Vérifier le certificat », ou faites installer l'autorité sur le serveur. (${brut})`;
  }
  if (b.includes("econnrefused")) {
    return `Connexion refusée sur ${smtp.host}:${smtp.port}. Vérifiez le port et l'ouverture du flux depuis le serveur applicatif. (${brut})`;
  }
  if (b.includes("etimedout") || b.includes("timeout")) {
    return `Délai dépassé vers ${smtp.host}:${smtp.port} — le flux est probablement bloqué par un pare-feu. (${brut})`;
  }
  if (b.includes("enotfound") || b.includes("eai_again")) {
    return `Nom de serveur introuvable : ${smtp.host}. Vérifiez l'orthographe et la résolution DNS. (${brut})`;
  }
  // Cas très fréquent en collectivité : Microsoft 365 refuse l'authentification
  // SMTP par défaut depuis 2022. Le message brut n'oriente vers aucune action.
  if (b.includes("5.7.139") || (b.includes("535") && smtp.host.includes("office365"))) {
    return (
      `Microsoft 365 refuse l'authentification SMTP pour ${smtp.user ?? "ce compte"}. ` +
      `Trois causes possibles, par ordre de fréquence : SMTP AUTH est désactivé sur la ` +
      `boîte (à réactiver dans le centre d'administration Exchange), le compte est ` +
      `protégé par MFA (l'authentification SMTP ne la gère pas), ou l'accès est bloqué ` +
      `par les paramètres de sécurité par défaut. Pour une application serveur, ` +
      `Microsoft recommande plutôt un connecteur de relais authentifié par IP ` +
      `(<tenant>.mail.protection.outlook.com, port 25, sans identifiant). (${brut})`
    );
  }
  if (b.includes("invalid login") || b.includes("535") || b.includes("authentication")) {
    return `Authentification refusée par ${smtp.host}. Vérifiez l'utilisateur et le mot de passe — ou laissez-les vides si le relais accepte le serveur sans authentification. (${brut})`;
  }
  if (b.includes("550") || b.includes("relay")) {
    return `Le serveur a refusé le relais. L'adresse d'expéditeur doit souvent appartenir au domaine de la collectivité. (${brut})`;
  }
  return brut;
}

export function echapper(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Teinte de l'application, reprise sur le filet, l'en-tête et les liens. */
const VERT = "#006e46";

/**
 * Pile de polices.
 *
 * Répétée sur CHAQUE élément de texte, et pas seulement sur `body` : les
 * clients de messagerie n'héritent pas de la police de manière fiable — Outlook
 * en particulier retombe sur Times New Roman dès qu'un élément ne la déclare
 * pas lui-même. C'est ce qui donne aux courriels leur air de document Word des
 * années 2000.
 */
const POLICE =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Repère les URL dans un texte déjà échappé, pour les rendre cliquables. */
const LIEN = /(https?:\/\/[^\s<>"]*[^\s<>".,;:])/g;

/**
 * Rend les adresses cliquables. Le lien d'émargement d'un animateur et le lien
 * de connexion d'un agent voyagent dans le corps du message : les laisser en
 * texte brut oblige à les recopier, et certaines messageries les coupent en
 * deux à l'affichage.
 */
export function avecLiens(texteEchappe: string): string {
  return texteEchappe.replace(
    LIEN,
    (url) =>
      `<a href="${url}" style="color:${VERT};text-decoration:underline;word-break:break-all">${url}</a>`,
  );
}

/**
 * Appel à l'action, écrit « [Libellé](https://…) » dans le corps du message.
 *
 * Un lien nu au milieu d'un paragraphe se recopie mal, se coupe en deux à
 * l'affichage, et ne dit pas ce qu'il fait. Seul sur sa ligne, il devient un
 * bouton ; à l'intérieur d'une phrase, un simple lien porté par son libellé.
 *
 * La notation est reprise du markdown pour une raison pratique : la version
 * texte brut du message, que reçoivent les clients qui n'affichent pas le HTML,
 * reste lisible une fois transformée en « Libellé : https://… ».
 */
const ACTION = /^\[([^\]]{1,60})\]\((https?:\/\/[^\s)]+)\)$/;
const ACTION_GLOBAL = /\[([^\]]{1,60})\]\((https?:\/\/[^\s)]+)\)/g;

/**
 * Où un bouton a le droit de mener.
 *
 * La notation s'applique à tout le corps du message, et une partie de ce corps
 * n'est pas écrite par l'application : le motif d'annulation d'un animateur, le
 * libellé d'une demande d'accès déposée depuis Internet. Sans cette liste,
 * quiconque écrit « [Me connecter](https://site-piège) » dans un champ libre
 * obtient un bouton dans un courriel signé de la collectivité, et c'est
 * exactement la forme que prend un hameçonnage.
 *
 * On ne filtre pas les champs un par un : il faudrait y penser à chaque
 * nouveau gabarit, et l'oubli ne se verrait pas. On borne plutôt la notation
 * elle-même aux origines que l'application connaît — les siennes, et elles
 * seules. Ailleurs, la notation reste du texte : l'adresse se voit telle
 * qu'elle est, et un lien qu'on lit n'est plus un piège.
 */
export function originesAutorisees(g: GeneralSettings): string[] {
  const candidates = [
    g.appUrl,
    g.pointageUrl,
    urlEspaceAgent(g),
    process.env.BOLT_PUBLIC_URL ?? "",
  ];
  return [...new Set(candidates.map(origineDe).filter((o): o is string => o !== null))];
}

function origineDe(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * `origines` absent : aucune restriction. C'est le cas de l'aperçu des
 * gabarits dans Paramètres → Messagerie, dont le texte est écrit dans le code —
 * et des tests. Un envoi réel passe toujours par `originesAutorisees`.
 */
function actionAcceptee(url: string, origines?: string[]): boolean {
  if (!origines) return true;
  const origine = origineDe(url);
  return origine !== null && origines.includes(origine);
}

/**
 * Bouton d'appel à l'action.
 *
 * En TABLEAU et non en `div` : Outlook rend le message avec le moteur de Word,
 * qui ignore `padding` sur une balise `a` — le bouton s'y réduirait à un texte
 * coloré. La couleur de fond est portée par l'attribut `bgcolor` autant que par
 * le CSS, pour la même raison. `border-radius` est simplement ignoré là-bas :
 * le bouton y est carré, ce qui n'a jamais empêché personne de cliquer.
 */
function bouton(libelle: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px"><tr><td bgcolor="${VERT}" style="border-radius:8px"><a href="${url}" style="display:inline-block;padding:13px 26px;font-family:${POLICE};font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:8px">${libelle}</a></td></tr></table>`;
}

/**
 * Mise en gras, écrite « **ainsi** » dans le corps du message.
 *
 * Elle sert d'abord aux dates et aux horaires : c'est ce qu'on relit d'un
 * courriel une fois ouvert, en diagonale et souvent sur un téléphone. « Votre
 * séance a lieu **mardi 15 septembre de 12:15 à 13:00** » se retrouve d'un
 * coup d'œil ; noyée dans la phrase, la même information oblige à relire le
 * paragraphe entier.
 *
 * Même notation que les textes saisis dans l'application (src/lib/markup.ts) :
 * une seule syntaxe pour qui écrit des messages ici. Une marque jamais
 * refermée, ou qui enjambe une ligne, reste du texte — mieux vaut une étoile
 * visible qu'une phrase qui disparaît.
 */
const GRAS = /\*\*([^*\n]+)\*\*/g;

/**
 * Version texte brut : « [Libellé](url) » redevient « Libellé : url », et les
 * marques de gras s'effacent.
 *
 * Le message est envoyé en deux parties, HTML et texte. Laisser la notation
 * telle quelle dans la seconde donnerait des crochets, des parenthèses et des
 * étoiles à quelqu'un qui, précisément, ne voit ni les boutons ni le gras.
 */
export function sansNotation(corps: string, origines?: string[]): string {
  return corps
    .replace(ACTION_GLOBAL, (tout, libelle, url) =>
      actionAcceptee(url, origines) ? `${libelle} : ${url}` : tout,
    )
    .replace(GRAS, "$1");
}

/**
 * Texte d'aperçu, affiché par la messagerie à côté de l'objet dans la liste
 * des messages. Sans lui, toutes les lignes se ressemblent : « Bonjour
 * Christophe, » n'apprend rien. On saute donc la salutation pour prendre la
 * première phrase utile.
 */
export function apercu(corps: string, origines?: string[]): string {
  const paragraphes = sansNotation(corps, origines).split(/\n{2,}/).map((p) => p.trim());
  const utile = paragraphes.find((p) => p && !/^bonjour\b/i.test(p)) ?? paragraphes[0] ?? "";
  const plat = utile.replace(/\s+/g, " ");
  return plat.length > 140 ? `${plat.slice(0, 139)}…` : plat;
}

/**
 * Gabarit HTML des courriels.
 *
 * Construit en TABLEAUX, et non en `div` : Outlook rend le HTML avec le moteur
 * de Word, qui ignore `max-width`, `border-radius`, `box-shadow` et la plupart
 * des marges. La mise en page précédente s'y effondrait en texte nu sur fond
 * blanc — la carte censée encadrer le message n'existait tout simplement pas
 * chez la moitié des destinataires. Un tableau de largeur fixe, lui, est
 * respecté partout depuis vingt ans.
 *
 * Les quelques propriétés modernes qui subsistent (angles arrondis) sont des
 * agréments : là où elles ne sont pas comprises, la mise en page reste entière.
 */
/**
 * Rend un message dans le gabarit, tel que le destinataire le verra.
 *
 * Exporté pour l'aperçu de Paramètres → Messagerie : un texte de courriel se
 * juge dans une boîte de réception, pas dans le code, et le gabarit fait la
 * moitié de l'impression qu'il donne.
 */
export async function rendreMail(titre: string, corps: string): Promise<string> {
  const g = await getGeneralSettings();
  const marque = g.logo || g.logoVille;
  // Sans liste d'origines : les exemples (src/lib/mail-exemples.ts) sont écrits
  // dans le code et se replient sur une adresse fictive tant que l'URL de
  // l'application n'est pas renseignée — l'aperçu doit montrer les boutons
  // quand même.
  const html = gabarit(titre, corps, logoPourMail(marque), g.appName, g.appDescription, g.orgName);
  // Le logo voyage en pièce jointe (`cid:`) dans un vrai envoi ; un navigateur
  // ne sait pas résoudre cette référence et n'afficherait qu'une image cassée.
  // On la remplace par la source configurée, le temps de l'aperçu.
  return marque ? html.replace(`cid:${CID_LOGO}`, marque) : html;
}

function gabarit(
  titre: string,
  corps: string,
  logoMail: LogoMail | null,
  appName: string,
  appDescription: string,
  organisation: string,
  origines?: string[],
): string {
  const paragraphes = corps
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => {
      const seul = p.trim().match(ACTION);
      if (seul && actionAcceptee(seul[2], origines)) {
        return bouton(echapper(seul[1]), echapper(seul[2]));
      }
      const enHtml = echapper(p.trim())
        // Les actions au fil du texte redeviennent des liens ordinaires, portés
        // par leur libellé : c'est plus court à lire qu'une URL entière. Une
        // origine étrangère reste en toutes lettres — `avecLiens` rendra
        // l'adresse cliquable, mais sous son propre nom.
        .replace(ACTION_GLOBAL, (tout, libelle, url) =>
          actionAcceptee(url, origines)
            ? `<a href="${url}" style="color:${VERT};text-decoration:underline">${libelle}</a>`
            : tout,
        )
        // `font-weight` en plus de la balise : le moteur de Word, avec lequel
        // Outlook rend les courriels, n'appuie pas toujours un `strong` qui
        // n'apporte que sa sémantique.
        .replace(
          GRAS,
          (_, texte) => `<strong style="font-weight:700;color:#0f172a">${texte}</strong>`,
        )
        .replace(/\n/g, "<br>");
      return `<p style="margin:0 0 16px;font-family:${POLICE};font-size:15px;line-height:24px;mso-line-height-rule:exactly;color:#334155">${avecLiens(enHtml)}</p>`;
    })
    .join("");

  // Les attributs `width`/`height` d'abord — seul bornage qu'Outlook respecte —,
  // repris en CSS pour les messageries qui, elles, suivent la feuille de style.
  const dims =
    logoMail?.largeur && logoMail?.hauteur
      ? ` width="${logoMail.largeur}" height="${logoMail.hauteur}" style="display:block;width:${logoMail.largeur}px;height:${logoMail.hauteur}px;border:0"`
      : ` height="${HAUTEUR_LOGO_MAIL}" style="display:block;height:${HAUTEUR_LOGO_MAIL}px;width:auto;border:0"`;

  // L'identité de l'application dans un bandeau : le logo à gauche, le nom et
  // sa ligne d'accompagnement à droite. En deux cellules plutôt qu'en `flex`,
  // qu'Outlook ne connaît pas — et le logo garde sa largeur déclarée, sans quoi
  // la cellule de texte se ferait écraser.
  const cellules = logoMail
    ? `<td width="${logoMail.largeur ?? HAUTEUR_LOGO_MAIL}" valign="middle" style="padding-right:14px">
                    <img src="cid:${CID_LOGO}" alt=""${dims}>
                  </td>
                  <td valign="middle">`
    : `<td valign="middle">`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Sans ces deux lignes, Outlook.com et Apple Mail inversent eux-mêmes les
     couleurs en thème sombre, et le vert de la collectivité y devient illisible. -->
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${echapper(titre)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;-webkit-text-size-adjust:100%">
<!-- Texte d'aperçu : lu par la messagerie dans sa liste, jamais affiché. -->
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${echapper(apercu(corps, origines))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9">
  <tr>
    <td align="center" style="padding:24px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px">
        <!-- Filet de couleur : un aplat de fond, que tout client sait rendre,
             là où une ombre portée ne serait vue que par la moitié d'entre eux. -->
        <tr><td height="4" style="height:4px;line-height:4px;font-size:0;background:${VERT};border-radius:12px 12px 0 0">&nbsp;</td></tr>
        <tr>
          <td style="padding:20px 32px;background:#f8fafc;border-bottom:1px solid #e2e8f0">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                ${cellules}
                  <div style="font-family:${POLICE};font-size:15px;line-height:20px;font-weight:700;color:#0f172a">${echapper(appName)}</div>
                  ${appDescription ? `<div style="font-family:${POLICE};font-size:12px;line-height:16px;color:#64748b">${echapper(appDescription)}</div>` : ""}
                  </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 18px">
            <h1 style="margin:0;font-family:${POLICE};font-size:21px;line-height:28px;font-weight:700;color:#0f172a">${echapper(titre)}</h1>
          </td>
        </tr>
        <tr><td style="padding:0 32px 14px">${paragraphes}</td></tr>
        <tr><td style="padding:0 32px 26px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td height="1" style="height:1px;line-height:1px;font-size:0;background:#e2e8f0">&nbsp;</td></tr>
          </table>
        </td></tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
        <tr>
          <td align="center" style="padding:14px 32px 0;font-family:${POLICE};font-size:12px;line-height:18px;color:#94a3b8">
            ${echapper(organisation)}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Corps de mail transmettant à un animateur son lien d'émargement et son code. */
export async function corpsLienAnimateur(
  prenom: string,
  lien: string,
  pin: string,
  expiration: Date | null,
): Promise<string> {
  const g = await getGeneralSettings();
  const lignes = [
    `Bonjour ${prenom},`,
    `Voici votre accès personnel pour pointer la présence des agents à vos séances. Il fonctionne depuis n'importe quel téléphone, sans installation et sans compte.`,
    `[Ouvrir ma feuille d'émargement](${lien})`,
    `Votre code à 6 chiffres : ${pin}`,
    `Le code vous est demandé à la première ouverture, puis une fois toutes les 8 heures. Conservez ces informations : le code ne peut pas être réaffiché, seulement régénéré.`,
  ];
  if (expiration) {
    lignes.push(
      `Cet accès est valable jusqu'au **${expiration.toLocaleDateString("fr-FR")}**.`,
    );
  }
  lignes.push(
    `Ce lien est strictement personnel : ne le transmettez pas.`,
    g.contactEmail
      ? `Une question ? Écrivez à ${g.contactEmail}.`
      : `Une question ? Contactez le service des sports.`,
  );
  return lignes.join("\n\n");
}
