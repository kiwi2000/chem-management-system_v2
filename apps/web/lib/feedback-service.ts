import type { FeedbackCommentDto, FeedbackDto } from "@chem/shared";
import type { Feedback, FeedbackComment } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * 未読の印を付けるための手がかり。
 * seenAt … その人が最後に一覧を開いた時刻（null なら一度も開いていない）
 * viewerId … その人自身。自分が最後に触ったものは未読にしない
 */
export interface ReadMarker {
  seenAt: Date | null;
  viewerId: string;
}

/** 名前は出ている分だけ引く（全ユーザーを持ってこない） */
async function namesOf(ids: (string | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((v): v is string => v !== null))];
  const users = uniq.length
    ? await prisma.user.findMany({
        where: { id: { in: uniq } },
        select: { id: true, displayName: true, email: true },
      })
    : [];
  return new Map(users.map((u) => [u.id, u.displayName ?? u.email]));
}

/**
 * 一覧・詳細に出す形へ。
 * 返信は数と最新の1件だけ添える。全部は詳細で読む
 */
export async function toFeedbackDtos(
  rows: Feedback[],
  marker?: ReadMarker,
): Promise<FeedbackDto[]> {
  const comments = rows.length
    ? await prisma.feedbackComment.findMany({
        where: { feedbackId: { in: rows.map((r) => r.id) }, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { feedbackId: true, body: true, createdBy: true, createdAt: true },
      })
    : [];
  const nameById = await namesOf([
    ...rows.map((r) => r.createdBy),
    ...comments.map((c) => c.createdBy),
  ]);

  const count = new Map<string, number>();
  const latest = new Map<string, (typeof comments)[number]>();
  for (const c of comments) {
    count.set(c.feedbackId, (count.get(c.feedbackId) ?? 0) + 1);
    // 新しい順に並べてあるので、最初に見たものが最新
    if (!latest.has(c.feedbackId)) latest.set(c.feedbackId, c);
  }

  return rows.map((r) => {
    const last = latest.get(r.id);
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      kind: r.kind,
      priority: r.priority,
      status: r.status,
      replyCount: count.get(r.id) ?? 0,
      lastReply: last
        ? {
            body: last.body,
            byName: last.createdBy ? (nameById.get(last.createdBy) ?? null) : null,
            at: last.createdAt.toISOString(),
          }
        : null,
      unread: marker ? isUnread(r, marker) : false,
      createdByName: r.createdBy ? (nameById.get(r.createdBy) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

/** 自分がまだ見ていないもの。自分が最後に触ったものは、自分にとって未読ではない */
function isUnread(r: Feedback, marker: ReadMarker): boolean {
  if (r.updatedBy === marker.viewerId) return false;
  return marker.seenAt === null || r.updatedAt > marker.seenAt;
}

/**
 * 返信を、詳細に出す形へ。
 *
 * 消したものは、**下にまだ生きている返信があるときだけ**場所を残す（本文は null）。
 * 残さないと、その下の返信が誰に向けたものか分からなくなる。
 * 下に何も残っていなければ、そのまま落とす
 */
export async function toCommentDtos(
  rows: FeedbackComment[],
  viewer: { id: string; isAdmin: boolean },
): Promise<FeedbackCommentDto[]> {
  const nameById = await namesOf(rows.map((r) => r.createdBy));

  // 生きている返信から親をたどり、「見せるべき」印を付ける
  const byId = new Map(rows.map((r) => [r.id, r]));
  const keep = new Set<string>();
  for (const r of rows) {
    if (r.deletedAt) continue;
    let cur: FeedbackComment | undefined = r;
    while (cur && !keep.has(cur.id)) {
      keep.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }

  return rows
    .filter((r) => keep.has(r.id))
    .map((r) => {
      const deleted = r.deletedAt !== null;
      return {
        id: r.id,
        parentId: r.parentId,
        body: deleted ? null : r.body,
        byName: r.createdBy ? (nameById.get(r.createdBy) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        canDelete: !deleted && (viewer.isAdmin || r.createdBy === viewer.id),
      };
    });
}
