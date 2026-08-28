import nodemailer from "nodemailer";
import { dimensionsImage, redimensionner } from "./images";
import { getGeneralSettings, getSmtpSettings, type SmtpSettings } from "./settings";

export type MailResult = { ok: boolean; message: string };

/**
 * Envoi SMTP. Volontairement tolérant : une relance ou une notification qui
 * n'part pas ne doit jamais faire échouer l'action métier correspondante
 * (valider une inscription, clôturer une séance).
 */
export async function envoyerMail(
  to: string,
  subject: string,
  corps: string,
): Promise<MailResult> {
  const smtp = await getSmtpSettings();
  if (!smtp?.host || !smtp?.from) {
    return { ok: false, message: "Messagerie non configurée (Paramètres → Messagerie)." };
  }
  if (!to) return { ok: false, message: "Destinataire sans adresse e-mail." };

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 25,
    secure: Boolean(smtp.secure),
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? "" } : undefined,
    tls: { rejectUnauthorized: smtp.tlsRejectUnauthorized !== false },
  });

  const g = await getGeneralSettings();
  // Le logo voyage en pièce jointe inline (référencée par `cid:`) : la plupart
  // des messageries ignorent les images en data URI dans le HTML — Gmail les
  // retire purement et simplement.
  const logo = logoPourMail(g.logo);
  try {
    await transport.sendMail({
      from: smtp.from,
      to,
      subject,
      text: corps,
      html: gabarit(subject, corps, logo, g.appName, g.appDescription, g.orgName),
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
    return { ok: false, message: expliquer(e, smtp) };
  }
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
 * Texte d'aperçu, affiché par la messagerie à côté de l'objet dans la liste
 * des messages. Sans lui, toutes les lignes se ressemblent : « Bonjour
 * Christophe, » n'apprend rien. On saute donc la salutation pour prendre la
 * première phrase utile.
 */
export function apercu(corps: string): string {
  const paragraphes = corps.split(/\n{2,}/).map((p) => p.trim());
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
function gabarit(
  titre: string,
  corps: string,
  logoMail: LogoMail | null,
  appName: string,
  appDescription: string,
  organisation: string,
): string {
  const paragraphes = corps
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${POLICE};font-size:15px;line-height:24px;mso-line-height-rule:exactly;color:#334155">${avecLiens(echapper(p.trim()).replace(/\n/g, "<br>"))}</p>`,
    )
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
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${echapper(apercu(corps))}</div>
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
    `Lien : ${lien}\nCode à 6 chiffres : ${pin}`,
    `Le code vous est demandé à la première ouverture, puis une fois toutes les 8 heures. Conservez ces informations : le code ne peut pas être réaffiché, seulement régénéré.`,
  ];
  if (expiration) {
    lignes.push(
      `Cet accès est valable jusqu'au ${expiration.toLocaleDateString("fr-FR")}.`,
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
