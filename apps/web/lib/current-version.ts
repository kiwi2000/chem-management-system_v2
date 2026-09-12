import { prisma } from "@/lib/db";

/**
 * 判定に使う「現在」の法規制バージョン。
 *
 * 判定の行は版ごとに持っている（2026-09-12 決定）ので、画面・一覧・書類に出すときは
 * 必ずこれで絞る。絞り忘れると、前の版の結果が混ざって件数が二重になる
 */
export async function getCurrentVersion(): Promise<{ id: string; code: string } | null> {
  return prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true, code: true },
  });
}
