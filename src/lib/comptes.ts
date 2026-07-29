import { prisma } from "./db";

/**
 * Recherche dans les comptes Bolt.
 *
 * Volontairement hors des fichiers « use server » : tout export d'un module
 * d'actions devient un point d'entrée appelable depuis le navigateur, et ce
 * helper ne porte aucun contrôle d'accès. Ce sont les actions qui l'appellent
 * qui vérifient les droits — session gestionnaire, ou jeton d'animateur avec
 * PIN validé.
 */
export type Candidat = {
  login: string; // sAMAccountName — identifiant pivot
  nom: string;
  email: string | null;
  service: string | null;
  direction: string | null;
  source: "compte" | "annuaire";
};

export async function chercherComptes(
  query: string,
  exclus: string[] = [],
): Promise<Candidat[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const comptes = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["AGENT", "GESTIONNAIRE", "COACH"] },
      ...(exclus.length > 0 ? { id: { notIn: exclus } } : {}),
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { login: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { displayName: "asc" },
    take: 10,
  });
  return comptes.map((u) => ({
    login: u.login.toLowerCase(),
    nom: u.displayName,
    email: u.email,
    service: u.service,
    direction: u.direction,
    source: "compte" as const,
  }));
}
