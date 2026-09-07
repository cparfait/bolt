import { getGeneralSettings } from "./settings";
import { LIEN_VALIDITE_LIBELLE } from "./constants";

/**
 * Catalogue des messages que Bolt envoie, avec un jeu de données d'exemple.
 *
 * Sert à deux choses qui se ressemblent sans se confondre :
 *
 *  • **la démonstration** — montrer à une commission, ou au service des sports,
 *    ce que l'agent recevra réellement, sans attendre qu'une inscription soit
 *    validée ni qu'une séance soit annulée. Certains de ces messages ne
 *    partent qu'une fois par an ;
 *  • **la relecture** — un texte de courriel se juge dans une boîte de
 *    réception, pas dans le code. Les voir côte à côte fait ressortir ce qui
 *    manque : une signature absente, un vouvoiement qui glisse, un lien nu.
 *
 * Les corps sont RECOPIÉS depuis leurs points d'envoi plutôt que factorisés
 * avec eux. C'est délibéré : rendre les vrais messages appelables d'ici
 * demanderait de fabriquer une inscription, une séance et un animateur
 * fictifs, donc d'écrire en base pour afficher un aperçu. Le prix de ce choix
 * est connu — un texte modifié à un endroit et pas à l'autre — et il se paie
 * en relisant cette page, ce qui est précisément son rôle.
 */

export type ExempleMail = {
  cle: string;
  titre: string;
  /** Quand ce message part, dans la vie de l'application. */
  quand: string;
  destinataire: string;
  objet: string;
  corps: string;
};

const AGENT = "Camille MARTIN";
const PRENOM = "Camille";

/** Le catalogue, dans l'ordre où un agent les rencontre. */
export async function exemplesMail(): Promise<ExempleMail[]> {
  const g = await getGeneralSettings();
  const base = (g.appUrl || "https://sports.exemple.fr").replace(/\/+$/, "");
  const contact = g.contactEmail || "sports@exemple.fr";
  const signature = `Le service des sports — ${contact}`;

  return [
    {
      cle: "acces-ouvert",
      titre: "Accès ouvert",
      quand: "Le service valide une demande d'accès déposée par une personne absente de l'annuaire.",
      destinataire: "l'agent",
      objet: `Votre accès à ${g.appName} est ouvert`,
      corps: [
        `Bonjour ${PRENOM},`,
        `Le service des sports a validé votre demande : vous pouvez désormais consulter les activités et vous y inscrire.`,
        `Pour vous connecter, indiquez cette adresse e-mail : vous recevrez un lien. Aucun mot de passe ne vous sera demandé.`,
        `[Accéder aux activités](${base}/acces)`,
        `Une question ? Écrivez au service des sports : ${contact}`,
      ].join("\n\n"),
    },
    {
      cle: "lien-connexion",
      titre: "Lien de connexion",
      quand: "L'agent demande un lien depuis l'espace public, à chaque connexion.",
      destinataire: "l'agent",
      objet: `Votre lien de connexion à ${g.appName}`,
      corps: [
        `Bonjour ${PRENOM},`,
        `Voici votre accès aux activités sportives. Il est valable ${LIEN_VALIDITE_LIBELLE} et ne sert qu'une fois — ensuite vous restez connecté sur cet appareil, sans avoir à le redemander.`,
        `[Me connecter](${base}/acces/lien?token=exemple-de-jeton)`,
        `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucun accès n'a été ouvert.`,
      ].join("\n\n"),
    },
    {
      cle: "demande-recue",
      titre: "Demande d'inscription reçue",
      quand: "L'agent demande une place ; le service ne s'est pas encore prononcé.",
      destinataire: "l'agent",
      objet: "Demande d'inscription reçue — Aquagym",
      corps: [
        `Bonjour ${PRENOM},`,
        `Votre demande d'inscription à Aquagym (**mardi 12:15–13:00**) est bien enregistrée.`,
        `Le service des sports l'examine : vous recevrez un message dès qu'une décision sera prise. Vous n'avez rien d'autre à faire d'ici là.`,
        signature,
      ].join("\n\n"),
    },
    {
      cle: "inscription-confirmee",
      titre: "Inscription confirmée",
      quand: "Le service valide la demande.",
      destinataire: "l'agent",
      objet: "Inscription confirmée — Aquagym",
      corps: [
        `Bonjour ${PRENOM},`,
        `Votre inscription à Aquagym est confirmée : **mardi de 12:15 à 13:00** — Piscine municipale.`,
        `Bonne pratique !`,
      ].join("\n\n"),
    },
    {
      cle: "liste-attente",
      titre: "Liste d'attente",
      quand: "Le créneau est complet au moment de la demande.",
      destinataire: "l'agent",
      objet: "Liste d'attente — Aquagym",
      corps: [
        `Bonjour ${PRENOM},`,
        `Le créneau de Aquagym (**mardi 12:15–13:00**) est complet : vous êtes en liste d'attente, en position 3.`,
        `Vous serez prévenu par courriel dès qu'une place se libère. Votre demande reste valable, il est inutile de la renouveler.`,
        signature,
      ].join("\n\n"),
    },
    {
      cle: "place-liberee",
      titre: "Place libérée",
      quand: "Un désistement fait avancer la file : le premier de la liste est promu.",
      destinataire: "l'agent",
      objet: "Une place s'est libérée en Aquagym",
      corps: [
        `Bonjour ${PRENOM},`,
        `Une place vient de se libérer sur le créneau de Aquagym (**mardi 12:15**). Votre inscription est confirmée.`,
        `Si vous ne souhaitez plus participer, prévenez le service des sports : ${contact}.`,
      ].join("\n\n"),
    },
    {
      cle: "demande-refusee",
      titre: "Demande non retenue",
      quand: "Le service refuse la demande, avec ou sans motif.",
      destinataire: "l'agent",
      objet: "Votre demande — Aquagym",
      corps: [
        `Bonjour ${PRENOM},`,
        `Votre demande d'inscription à Aquagym n'a pas pu être retenue : le quota d'activités par agent est atteint.`,
        `D'autres créneaux restent ouverts : consultez le catalogue de l'application.`,
      ].join("\n\n"),
    },
    {
      cle: "rappel-seance",
      titre: "Rappel de séance",
      quand: "La veille de chaque séance, automatiquement.",
      destinataire: "l'agent",
      objet: "Rappel — Aquagym mardi 15 septembre",
      corps: [
        `Bonjour ${PRENOM},`,
        `Petit rappel : votre séance de Aquagym a lieu **mardi 15 septembre de 12:15 à 13:00**, Piscine municipale.`,
        `Un empêchement ? Prévenez le service des sports : votre place profitera à un collègue en liste d'attente.`,
        signature,
      ].join("\n\n"),
    },
    {
      cle: "seance-annulee",
      titre: "Séance annulée",
      quand: "Le service annule une ou plusieurs séances.",
      destinataire: "l'agent",
      objet: "Séance annulée — Aquagym",
      corps: [
        `Bonjour ${PRENOM},`,
        `La séance suivante n'aura pas lieu :`,
        `— Aquagym, **mardi 15 septembre, 12:15–13:00** (Piscine municipale)`,
        `Motif : bassin fermé pour maintenance`,
        `Votre inscription reste valable et les autres séances sont maintenues : il n'y a rien à faire de votre part.`,
        signature,
      ].join("\n\n"),
    },
    {
      cle: "seance-maintenue",
      titre: "Séance rétablie",
      quand: "Une séance annulée est finalement maintenue.",
      destinataire: "l'agent",
      objet: "Séance maintenue — Aquagym",
      corps: [
        `Bonjour ${PRENOM},`,
        `Bonne nouvelle : la séance de Aquagym du **mardi 15 septembre, 12:15–13:00** (Piscine municipale), aura finalement bien lieu.`,
        `Elle avait été annulée : vous pouvez la réinscrire à votre agenda.`,
        signature,
      ].join("\n\n"),
    },
    {
      cle: "creneau-modifie",
      titre: "Créneau modifié",
      quand: "L'horaire, le lieu ou le calendrier d'un créneau change.",
      destinataire: "l'agent",
      objet: "Changement — Aquagym",
      corps: [
        `Bonjour ${PRENOM},`,
        `Votre créneau de Aquagym — **mardi 12:15** a été modifié.`,
        `Nouvel horaire : **12:30–13:15**\n(auparavant 12:15–13:00)`,
        `Il n'y aura finalement PAS de séance pendant :\n• les vacances de la Toussaint (**18/10/2026 → 02/11/2026**)`,
        `Votre inscription reste valable : rien à faire de votre part. Consultez le détail dans l'application à tout moment.`,
        signature,
      ].join("\n\n"),
    },
    {
      cle: "lien-animateur",
      titre: "Lien d'émargement d'un animateur",
      quand: "Le service crée un animateur, ou régénère son accès.",
      destinataire: "l'animateur",
      objet: `Votre accès d'émargement — ${g.appName}`,
      corps: [
        `Bonjour Claire,`,
        `Voici votre accès personnel pour pointer la présence des agents à vos séances. Il fonctionne depuis n'importe quel téléphone, sans installation et sans compte.`,
        `[Ouvrir ma feuille d'émargement](${base}/emargement/exemple-de-jeton)`,
        `Votre code à 6 chiffres : 481027`,
        `Le code vous est demandé à la première ouverture, puis une fois toutes les 8 heures. Conservez ces informations : le code ne peut pas être réaffiché, seulement régénéré.`,
        `Ce lien est strictement personnel : ne le transmettez pas.`,
        `Une question ? Écrivez à ${contact}.`,
      ].join("\n\n"),
    },
    {
      cle: "demandes-a-traiter",
      titre: "Demandes d'accès à traiter",
      quand: "Résumé périodique adressé au service, tant que des demandes attendent.",
      destinataire: "le service des sports",
      objet: `${g.appName} — 2 demandes d'accès à traiter`,
      corps: [
        `2 personnes absentes de l'annuaire attendent un accès à ${g.appName}.`,
        `— ${AGENT} (camille.martin@exemple.fr) · Petite Enfance\n— Julien BERNARD (julien.bernard@exemple.fr)`,
        `Aucun compte n'est créé, et rien ne part vers ces adresses tant que vous n'avez pas validé.`,
        `[Examiner les demandes](${base}/agents/demandes)`,
      ].join("\n\n"),
    },
    {
      cle: "alerte-securite",
      titre: "Alerte de sécurité",
      quand: "Un plafond d'envoi ou de tentatives est atteint. Adressé au service, jamais à un agent.",
      destinataire: "le service des sports",
      objet: `${g.appName} — plafond de demandes de lien atteint`,
      corps: [
        `Le plafond de demandes de lien de connexion a été atteint : 30 demandes en une heure depuis la même adresse.`,
        `Ce message est envoyé au plus deux fois par heure. Le détail complet, horodaté et avec les adresses IP, se trouve dans ${g.appName} : Paramètres → Journal.`,
        `Aucune action n'est requise dans l'immédiat : le plafond a fait son travail, il a arrêté les envois. Prévenez la DSI si le message se répète.`,
      ].join("\n\n"),
    },
  ];
}
