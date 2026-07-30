import nodemailer from "nodemailer";
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
  // Même ligne que sous le logo des écrans de connexion : le destinataire doit
  // pouvoir nommer l'outil qui lui écrit, logo ou pas.
  const signature = [g.appName, g.appDescription].filter(Boolean).join(" · ");

  try {
    await transport.sendMail({
      from: smtp.from,
      to,
      subject,
      text: corps,
      html: gabarit(subject, corps, Boolean(logo), signature),
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

/**
 * Prépare le logo configuré pour l'envoi en pièce jointe inline.
 * Formats matriciels uniquement : le SVG n'est pas affiché par Gmail ni
 * Outlook, même en pièce jointe — un logo SVG laisse le mail sans image
 * plutôt que d'y glisser une icône cassée.
 */
function logoPourMail(
  dataUri: string,
): { contenu: Buffer; mime: string; extension: string } | null {
  const m = dataUri.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!m) return null;
  return {
    contenu: Buffer.from(m[2], "base64"),
    mime: m[1],
    extension: EXTENSIONS[m[1]],
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

function echapper(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Gabarit HTML sobre, aux couleurs de l'application. */
function gabarit(
  titre: string,
  corps: string,
  avecLogo: boolean,
  signature: string,
): string {
  const paragraphes = corps
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.6">${echapper(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const logo = avecLogo
    ? `<img src="cid:${CID_LOGO}" alt="" style="display:block;max-height:44px;margin:0 0 14px">\n    `
    : "";
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 4px 20px rgba(0,0,0,.06)">
    ${logo}<p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#006e46;letter-spacing:.04em;text-transform:uppercase">${signature}</p>
    <h1 style="margin:0 0 18px;font-size:19px;color:#0f172a">${echapper(titre)}</h1>
    <div style="font-size:15px;color:#334155">${paragraphes}</div>
  </div>
</div>`;
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
