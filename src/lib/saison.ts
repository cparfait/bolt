import { prisma } from "./db";

/**
 * Saison courante : celle marquée active, sinon la plus récente.
 * Le repli évite un outil vide juste après l'installation, avant que le service
 * des sports n'ait activé sa première saison.
 */
export async function saisonCourante() {
  return (
    (await prisma.saison.findFirst({ where: { active: true } })) ??
    (await prisma.saison.findFirst({ orderBy: { debut: "desc" } }))
  );
}
