import { headers } from "next/headers";
import { prisma } from "./db";
import { clientIp } from "@/lib/net";

export type AuditInput = {
  userId?: string; // qui a agi
  acteur?: string; // libellé lisible quand il n'y a pas de compte (animateur par lien)
  cible?: string; // sur quoi, en toutes lettres
  /**
   * Sur QUI, quand c'est quelqu'un de connu. C'est ce qui rend le journal
   * lisible depuis une fiche d'agent : `cible` est un libellé, `cibleId` se
   * requête. À renseigner dès qu'une action porte sur un compte — même quand
   * l'acteur est ce compte lui-même, pour que sa fiche montre tout ce qui le
   * concerne d'une seule requête.
   */
  cibleId?: string;
  details?: string;
};

/**
 * Écrit une ligne de journal. Best-effort : une erreur d'écriture ne doit
 * jamais faire échouer l'action métier qu'elle documente.
 */
export async function audit(action: string, input: AuditInput = {}): Promise<void> {
  try {
    let ip: string | undefined;
    try {
      ip = clientIp(await headers()) || undefined;
    } catch {
      // hors contexte de requête (script, seed)
    }
    await prisma.auditLog.create({ data: { action, ip, ...input } });
  } catch {
    // journal indisponible : on continue
  }
}
