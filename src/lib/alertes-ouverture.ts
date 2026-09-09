import { prisma } from "./db";
import { adresseDeContact } from "./comptes";
import { nomPourSalutation } from "./constants";
import { JOUR_LABELS } from "./dates";
import { envoyerMail } from "./mail";
import { getGeneralSettings, urlEspaceAgent } from "./settings";
import { audit } from "./audit";

/**
 * « Prévenez-moi quand ça rouvre. »
 *
 * Un créneau fermé aux inscriptions, c'est presque toujours un « pas
 * encore » : animateur à confirmer, salle à obtenir, effectif à arbitrer.
 * L'agent qui tombe dessus n'avait qu'une possibilité, revenir voir — et il
 * ne revenait pas, ou trop tard, une fois les places prises. La demande
 * d'alerte transforme ce « revenez plus tard » en un courriel au moment
 * où le service rouvre.
 *
 * Aucune promesse de place : le courriel dit que les inscriptions sont
 * ouvertes et renvoie au catalogue, où la règle habituelle s'applique.
 */

export type ResultatAlerte = { posee: boolean };

/** Pose l'alerte si elle n'existe pas, la retire sinon. */
export async function basculerAlerte(userId: string, creneauId: string): Promise<ResultatAlerte> {
  const existante = await prisma.alerteOuverture.findUnique({
    where: { creneauId_userId: { creneauId, userId } },
    select: { id: true },
  });
  if (existante) {
    await prisma.alerteOuverture.delete({ where: { id: existante.id } });
    return { posee: false };
  }
  await prisma.alerteOuverture.create({ data: { creneauId, userId } });
  return { posee: true };
}

export type ResultatNotificationOuverture = { destinataires: number; envoyes: number };

/**
 * Prévient tous ceux qui attendaient l'ouverture d'un créneau, puis efface
 * leur alerte. Une alerte dont le courriel n'a pas pu partir reste en place :
 * la prochaine réouverture — ou une relance à la main — la retentera.
 *
 * Best-effort, comme les autres notifications : une messagerie muette ne
 * doit pas empêcher le service de rouvrir un créneau.
 */
export async function notifierOuverture(creneauId: string): Promise<ResultatNotificationOuverture> {
  const alertes = await prisma.alerteOuverture.findMany({
    where: { creneauId },
    include: {
      user: { select: { id: true, displayName: true, email: true, emailContact: true, active: true } },
      creneau: { include: { activite: { select: { id: true, nom: true } } } },
    },
  });
  if (alertes.length === 0) return { destinataires: 0, envoyes: 0 };

  const g = await getGeneralSettings();
  const catalogue = `${urlEspaceAgent(g)}/mes-activites?activite=${alertes[0].creneau.activite.id}`;
  let envoyes = 0;
  const servies: string[] = [];

  for (const a of alertes) {
    const adresse = a.user.active ? adresseDeContact(a.user) : null;
    if (!adresse) {
      // Compte parti ou sans adresse : l'alerte ne servira jamais.
      servies.push(a.id);
      continue;
    }
    const c = a.creneau;
    const envoi = await envoyerMail(
      adresse,
      `Les inscriptions à ${c.activite.nom} sont ouvertes`,
      [
        `Bonjour ${nomPourSalutation(a.user.displayName)},`,
        `Vous aviez demandé à être prévenu : les inscriptions au créneau de ${c.activite.nom} (**${JOUR_LABELS[c.jour].toLowerCase()} ${c.heureDebut}–${c.heureFin}**${c.lieu ? `, ${c.lieu}` : ""}) viennent d'ouvrir.`,
        `Les places se prennent dans l'ordre des demandes : si le créneau vous intéresse toujours, inscrivez-vous sans attendre.`,
        `[Voir le créneau](${catalogue})`,
        g.contactEmail ? `Le service des sports — ${g.contactEmail}` : `Le service des sports`,
      ].join("\n\n"),
    );
    if (envoi.ok) {
      envoyes += 1;
      servies.push(a.id);
    }
  }

  if (servies.length > 0) {
    await prisma.alerteOuverture.deleteMany({ where: { id: { in: servies } } });
  }
  await audit("ALERTES_OUVERTURE_ENVOYEES", {
    cible: `${alertes[0].creneau.activite.nom} ${JOUR_LABELS[alertes[0].creneau.jour]} ${alertes[0].creneau.heureDebut}`,
    details: `${envoyes} envoyé(s) sur ${alertes.length}`,
  });
  return { destinataires: alertes.length, envoyes };
}

/** Libellé du résultat, pour le message de retour au service. */
export function decrireNotificationOuverture(r: ResultatNotificationOuverture): string {
  if (r.destinataires === 0) return "";
  if (r.envoyes > 0) {
    return ` ${r.envoyes} agent${r.envoyes > 1 ? "s" : ""} qui attendai${r.envoyes > 1 ? "ent" : "t"} l'ouverture ${r.envoyes > 1 ? "ont" : "a"} été prévenu${r.envoyes > 1 ? "s" : ""}.`;
  }
  return ` ${r.destinataires} agent${r.destinataires > 1 ? "s" : ""} attendai${r.destinataires > 1 ? "ent" : "t"} l'ouverture, mais aucun courriel n'a pu partir — vérifiez la messagerie.`;
}
