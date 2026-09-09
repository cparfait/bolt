import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { secretApplicatif } from "./secret";

/**
 * Chiffrement des secrets rangés dans la table `Setting` : le mot de passe du
 * compte de service Active Directory et celui de la messagerie.
 *
 * Ils étaient stockés en clair dans un JSON. Toute sauvegarde de la base, tout
 * accès au répertoire de données ou un `psql` depuis l'hôte les livrait — et
 * le premier est un identifiant de domaine. AES-256-GCM, avec une clé dérivée
 * de SESSION_SECRET : le secret existe déjà, il est obligatoire en production,
 * et n'en ajouter aucun autre évite un fichier de plus à protéger.
 *
 * Conséquence assumée : changer SESSION_SECRET rend ces deux mots de passe
 * illisibles. L'application le dit alors à l'écran des paramètres (le champ
 * apparaît « à ressaisir »), et la connexion à l'annuaire échoue jusqu'à la
 * ressaisie — ce qui vaut mieux qu'un secret lisible dans une sauvegarde.
 *
 * Format stocké : `enc1:<iv>:<tag>:<données>`, en base64url. Une valeur qui ne
 * commence pas par le préfixe est lue telle quelle, pour les réglages
 * enregistrés avant ce chiffrement ; elle est chiffrée au prochain
 * enregistrement.
 */

const PREFIXE = "enc1";

function cle(): Buffer {
  return createHash("sha256").update(`bolt-settings:${secretApplicatif()}`).digest();
}

export function chiffrer(clair: string): string {
  const iv = randomBytes(12);
  const chiffreur = createCipheriv("aes-256-gcm", cle(), iv);
  const donnees = Buffer.concat([chiffreur.update(clair, "utf8"), chiffreur.final()]);
  const tag = chiffreur.getAuthTag();
  return [PREFIXE, iv, tag, donnees].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(":");
}

export function estChiffre(valeur: string): boolean {
  return valeur.startsWith(`${PREFIXE}:`);
}

/**
 * Déchiffre, ou renvoie la valeur telle quelle si elle n'est pas chiffrée.
 * Renvoie null si la valeur est chiffrée mais illisible — secret changé, ou
 * ligne altérée : l'appelant doit alors demander une ressaisie, pas envoyer un
 * mot de passe faux à l'annuaire.
 */
export function dechiffrer(valeur: string): string | null {
  if (!estChiffre(valeur)) return valeur;
  const [, iv, tag, donnees] = valeur.split(":");
  if (!iv || !tag || !donnees) return null;
  try {
    const dechiffreur = createDecipheriv("aes-256-gcm", cle(), Buffer.from(iv, "base64url"));
    dechiffreur.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      dechiffreur.update(Buffer.from(donnees, "base64url")),
      dechiffreur.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
