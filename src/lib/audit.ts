import { headers } from "next/headers";
import { prisma } from "./db";
import { clientIp } from "@/lib/net";

export type AuditInput = {
  userId?: string;
  acteur?: string; // libellé lisible quand il n'y a pas de compte (animateur par lien)
  cible?: string;
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
