import { prisma } from "./db";
import { getLdapSettings } from "./settings";
import { ldapSearchAccounts } from "./ldap";
import { serviceResolu } from "./services";

/**
 * Création d'un compte agent depuis l'annuaire — serveur seulement.
 *
 * Deux raisons de l'isoler. Hors d'un module « use server » : tout export
 * d'un tel module devient un point d'entrée appelable depuis le navigateur,
 * sans session, et celui-ci crée des comptes. Hors de `comptes.ts` : ce
 * fichier-là est importé par des composants clients pour ses types et ses
 * libellés, et le client LDAP (node:net) n'a rien à faire dans un bundle
 * navigateur.
 */

/**
 * Garantit l'existence du compte applicatif d'un agent, à partir de son
 * identifiant d'annuaire. Le compte créé ici n'a pas de mot de passe : l'agent
 * se connectera en LDAPS et récupérera ses inscriptions.
 */
export async function assurerCompteAgent(login: string): Promise<string | null> {
  const cle = login.trim().toLowerCase();
  if (!cle) return null;

  const existant = await prisma.user.findUnique({ where: { login: cle } });
  if (existant) return existant.id;

  let nom = cle;
  let email: string | null = null;
  let service: string | null = null;
  let direction: string | null = null;

  const miroir = await prisma.adAccount.findFirst({
    where: { samAccountName: { equals: cle, mode: "insensitive" } },
  });
  if (miroir) {
    nom = miroir.displayName ?? miroir.samAccountName;
    email = miroir.email;
    service = miroir.service;
    direction = miroir.direction;
  } else {
    try {
      const ldap = await getLdapSettings();
      if (ldap?.bindDn && ldap?.bindPassword) {
        const [trouve] = await ldapSearchAccounts(ldap, cle, 1);
        if (trouve) {
          nom = trouve.displayName ?? trouve.samAccountName;
          email = trouve.email ?? null;
          service = trouve.service ?? null;
          direction = trouve.direction ?? null;
          // On alimente le miroir au passage : la prochaine recherche sera locale.
          const { samAccountName, ...reste } = trouve;
          await prisma.adAccount.upsert({
            where: { samAccountName },
            update: { ...reste, syncedAt: new Date() },
            create: { samAccountName, ...reste, syncedAt: new Date() },
          });
        }
      }
    } catch {
      // on crée quand même le compte avec le seul identifiant
    }
  }

  const user = await prisma.user.create({
    data: {
      login: cle,
      displayName: nom,
      email,
      service: await serviceResolu(service),
      direction,
      role: "AGENT",
    },
  });
  return user.id;
}
