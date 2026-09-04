import { getGeneralSettings } from "./settings";
import { envoyerMail } from "./mail";
import { rateLimit } from "./rate-limit";
import { audit } from "./audit";

/**
 * Alerte le service des sports quand un plafond de sécurité se déclenche.
 *
 * Ces plafonds — liens de connexion, demandes d'accès — sont les seuls signaux
 * qui diront qu'on vous attaque. Jusqu'ici ils n'écrivaient qu'une ligne dans
 * le journal, consultable depuis *Paramètres → Journal*. Un signal que
 * personne ne va chercher n'est pas un signal : il documente l'incident après
 * coup, il ne le fait pas remarquer.
 *
 * Le courriel part vers `contactEmail`, adresse fixe et interne : cette
 * fonction n'expose donc aucun moyen de faire écrire l'application à une
 * adresse choisie par l'attaquant. Et elle est elle-même plafonnée — sans quoi
 * une alerte anti-inondation deviendrait l'inondation.
 */

const ALERTES_PAR_HEURE = 2;

export async function alerterSecurite(
  cle: string,
  sujet: string,
  corps: string,
): Promise<void> {
  const g = await getGeneralSettings();
  if (!g.contactEmail) return;

  // Deux alertes par heure et par motif : assez pour ne pas rater le début
  // d'une attaque, trop peu pour saturer la boîte pendant qu'elle dure. La
  // suite se lit dans le journal.
  if (!rateLimit(`alerte:${cle}`, ALERTES_PAR_HEURE, 3600).ok) return;

  await envoyerMail(
    g.contactEmail,
    `${g.appName} — ${sujet}`,
    [
      corps,
      `Ce message est envoyé au plus deux fois par heure. Le détail complet, horodaté et avec les adresses IP, se trouve dans ${g.appName} : Paramètres → Journal.`,
      `Aucune action n'est requise dans l'immédiat : le plafond a fait son travail, il a arrêté les envois. Prévenez la DSI si le message se répète.`,
    ].join("\n\n"),
  );
  await audit("ALERTE_ENVOYEE", { cible: cle });
}
