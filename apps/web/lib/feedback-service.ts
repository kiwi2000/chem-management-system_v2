import type { FeedbackDto } from "@chem/shared";
import type { Feedback } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * 一覧・詳細に出す形へ。
 * 投稿者の名前は一覧に出ている分だけ引く（全ユーザーを持ってこない）。
 */
export async function toFeedbackDtos(rows: Feedback[]): Promise<FeedbackDto[]> {
  const ids = [...new Set(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])))];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true, email: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.displayName ?? u.email]));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    kind: r.kind,
    priority: r.priority,
    status: r.status,
    createdByName: r.createdBy ? (nameById.get(r.createdBy) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}
