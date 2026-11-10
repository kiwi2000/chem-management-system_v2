import type { Group, News, OrganisationKind, User } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { rowStamp } from "@/lib/edit-stamp";
import type { NewsDto } from "@/lib/types";

/** 日付だけを扱う（時刻は持たない）。掲載期間の比較は日単位で行う */
export function parseDateOnly(v: string | null | undefined): Date | null {
  if (!v) return null;
  return new Date(`${v}T00:00:00.000Z`);
}

export function formatDateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

type GroupName = Pick<Group, "id" | "nameJa" | "nameEn" | "displayOrder">;

export type NewsWithAuthor = News & {
  author: Pick<User, "id" | "displayName" | "email"> & {
    /** 所属する組織（S31 から 1 つ）。「所属」としてそのまま出す */
    organisation?: (GroupName & { kind: OrganisationKind }) | null;
  };
  group?: GroupName | null;
};

/** 一覧・詳細で毎回同じものを読むので共通化する */
export const NEWS_INCLUDE = {
  author: {
    select: {
      id: true,
      displayName: true,
      email: true,
      // 一覧に「所属 / 氏名 / 日時」を出すので、投稿者の所属も一緒に読む。
      // S31 から人の組織は 1 つなので、それをそのまま出す。利用者の編集画面で割り当てる
      organisation: {
        select: { id: true, kind: true, nameJa: true, nameEn: true, displayOrder: true },
      },
    },
  },
  group: { select: { id: true, nameJa: true, nameEn: true, displayOrder: true } },
} as const;

export function toNewsDto(n: NewsWithAuthor, actor: Actor): NewsDto {
  const department = n.author.organisation ?? null;
  return {
    stamp: rowStamp(n),
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
    authorOrgNameJa: department?.nameJa ?? null,
    authorOrgNameEn: department?.nameEn ?? null,
    groupId: n.groupId,
    groupNameJa: n.group?.nameJa ?? null,
    groupNameEn: n.group?.nameEn ?? null,
    groupOrder: n.group?.displayOrder ?? null,
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
