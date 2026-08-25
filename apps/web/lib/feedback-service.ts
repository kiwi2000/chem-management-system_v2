import type { FeedbackDto } from "@chem/shared";
import type { Feedback } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * 一覧・詳細に出す形へ。
 * 投稿者の名前は一覧に出ている分だけ引く（全ユーザーを持ってこない）。
 */
/**
 * 未読の印を付けるための手がかり。
 * seenAt … その人が最後に一覧を開いた時刻（null なら一度も開いていない）
 * viewerId … その人自身。自分が最後に触ったものは未読にしない
 */
export interface ReadMarker {
  seenAt: Date | null;
  viewerId: string;
}

export async function toFeedbackDtos(
  rows: Feedback[],
  marker?: ReadMarker,
): Promise<FeedbackDto[]> {
  const ids = [
    ...new Set(
      rows.flatMap((r) => [
        ...(r.createdBy ? [r.createdBy] : []),
        ...(r.repliedBy ? [r.repliedBy] : []),
      ]),
    ),
  ];
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
    reply: r.reply,
    unread: marker ? isUnread(r, marker) : false,
    repliedByName: r.repliedBy ? (nameById.get(r.repliedBy) ?? null) : null,
    repliedAt: r.repliedAt?.toISOString() ?? null,
    createdByName: r.createdBy ? (nameById.get(r.createdBy) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** 自分がまだ見ていないもの。自分が最後に触ったものは、自分にとって未読ではない */
function isUnread(r: Feedback, marker: ReadMarker): boolean {
  if (r.updatedBy === marker.viewerId) return false;
  return marker.seenAt === null || r.updatedAt > marker.seenAt;
}
