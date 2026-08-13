import type { News, User } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import type { NewsDto } from "@/lib/types";

/** 日付だけを扱う（時刻は持たない）。掲載期間の比較は日単位で行う */
export function parseDateOnly(v: string | null | undefined): Date | null {
  if (!v) return null;
  return new Date(`${v}T00:00:00.000Z`);
}

export function formatDateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export type NewsWithAuthor = News & { author: Pick<User, "id" | "displayName" | "email"> };

export function toNewsDto(n: NewsWithAuthor, actor: Actor): NewsDto {
  return {
    id: n.id,
    titleJa: n.titleJa,
    bodyJa: n.bodyJa,
    titleEn: n.titleEn,
    bodyEn: n.bodyEn,
    status: n.status,
    pinned: n.pinned,
    publishFrom: formatDateOnly(n.publishFrom),
    publishUntil: formatDateOnly(n.publishUntil),
    authorId: n.authorId,
    authorName: n.author.displayName ?? n.author.email,
    updatedAt: n.updatedAt.toISOString(),
    editable: canEditNews(actor, n.authorId),
  };
}

/** 自分の投稿は NEWS_POST で、他人の投稿は NEWS_MANAGE で編集・削除できる */
export function canEditNews(actor: Actor, authorId: string): boolean {
  if (actor.has("NEWS_MANAGE")) return true;
  return actor.has("NEWS_POST") && actor.user.id === authorId;
}

/**
 * ホームに出す「今掲載中」の条件。
 * 公開済みで、掲載開始日が来ていて、掲載終了日を過ぎていないもの。
 * 掲載終了日は「その日いっぱい」を含む。
 */
export function publishedNowWhere(now: Date) {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return {
    status: "PUBLISHED" as const,
    AND: [
      { OR: [{ publishFrom: null }, { publishFrom: { lte: today } }] },
      { OR: [{ publishUntil: null }, { publishUntil: { gte: today } }] },
    ],
  };
}
