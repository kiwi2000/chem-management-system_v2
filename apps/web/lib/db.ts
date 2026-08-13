import { PrismaClient } from "@prisma/client";

/**
 * PrismaClient シングルトン。
 * dev のホットリロードで接続が増殖しないよう globalThis に保持する。
 * 業務データへのアクセスは必ずこのクライアント経由（RLS・DB固有機能に依存しない: CLAUDE.md §2）。
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
