import { PrismaClient } from "@prisma/client";

// En développement, Next recharge les modules à chaud : sans ce cache global,
// chaque rechargement ouvrirait un nouveau pool de connexions.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
