import type { News, Organisation, User } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { todayInJapan } from "@/lib/judgement-date";
import { orgChain, type OrgChainNode } from "@/lib/organisation-tree";
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

type OrgName = Pick<Organisation, "id" | "nameJa" | "nameEn">;

export type NewsWithAuthor = News & {
  author: Pick<User, "id" | "displayName" | "email">;
  fromOrganisation?: OrgName | null;
  toOrganisation?: OrgName | null;
};

/** 一覧・詳細で毎回同じものを読むので共通化する */
export const NEWS_INCLUDE = {
  author: { select: { id: true, displayName: true, email: true } },
  fromOrganisation: { select: { id: true, nameJa: true, nameEn: true } },
  toOrganisation: { select: { id: true, nameJa: true, nameEn: true } },
} as const;

export function toNewsDto(n: NewsWithAuthor, actor: Actor): NewsDto {
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
    fromOrganisationId: n.fromOrganisationId,
    fromNameJa: n.fromOrganisation?.nameJa ?? null,
    fromNameEn: n.fromOrganisation?.nameEn ?? null,
    toOrganisationId: n.toOrganisationId,
    toNameJa: n.toOrganisation?.nameJa ?? null,
    toNameEn: n.toOrganisation?.nameEn ?? null,
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
 * **今日は日本の日付で決める**（2026-11-12。世界標準時の日付で比べていて、開始日の朝 9 時まで出ず、
 * 終了日の翌朝 9 時まで出続けていた）。掲載日の列は、選んだ日付の UTC 0 時で入っている
 */
export function publishedNowWhere(now: Date) {
  const today = new Date(`${todayInJapan(now)}T00:00:00.000Z`);
  return {
    status: "PUBLISHED" as const,
    AND: [
      { OR: [{ publishFrom: null }, { publishFrom: { lte: today } }] },
      { OR: [{ publishUntil: null }, { publishUntil: { gte: today } }] },
    ],
  };
}

/*
  ── 差出元と宛先（2026-11-11）───────────────────────────
  お知らせの分類をやめ、組織から選ぶ形にした。
  差出元 … どこからのお知らせか。ホームの見出しはこれで分ける
  宛先   … だれ宛てか。その組織とその下の人にだけ見える。null は全員宛て
  選べるのは、投稿する人の組織とその上の組織だけ。「全員」は NEWS_MANAGE の人だけ
*/

/** その人の組織から上へたどった組織（自分の組織が先頭）。組織の無い人は空 */
export function newsOrgChain(actor: Actor): Promise<OrgChainNode[]> {
  return orgChain(actor.user.organisationId ?? null);
}

/**
 * 差出元・宛先に新しく選べる組織（2026-11-12）。無効にした組織は選べない（ほかの画面の組織選びと同じ）。
 * **見える範囲には使わない。**無効にした組織の人にも、その組織宛て・上の組織宛てのお知らせは今までどおり見える
 */
export function newsChoices<T extends { activeFlag: boolean }>(chain: T[]): T[] {
  return chain.filter((o) => o.activeFlag);
}

/**
 * 監査の記録に残す差出元・宛先（2026-11-12）。id だけでは読めないので名前も残す。
 * 宛先の「全員」は、空ではなく印（ALL）で残す。見える範囲がいちばん広がる変更なので、はっきり分かるように
 */
export async function newsOrgAudit(v: {
  fromOrganisationId: string | null;
  toOrganisationId: string | null;
}) {
  const ids = [v.fromOrganisationId, v.toOrganisationId].filter((x): x is string => x !== null);
  const rows = await prisma.organisation.findMany({
    where: { id: { in: ids } },
    select: { id: true, nameJa: true },
  });
  const name = (id: string | null) => rows.find((r) => r.id === id)?.nameJa ?? null;
  return {
    fromOrganisationId: v.fromOrganisationId,
    fromOrganisation: name(v.fromOrganisationId),
    toOrganisationId: v.toOrganisationId,
    toOrganisation: v.toOrganisationId === null ? "ALL" : name(v.toOrganisationId),
  };
}

/**
 * 宛先で見えるお知らせの条件。宛先が全員か、自分の組織かその上の組織のもの。
 * **最上位に AND を使わない**（一覧の buildWhere の AND と `...` で混ぜるため。CLAUDE.md）
 */
export function addressedToWhere(chainIds: string[]) {
  return {
    OR: [{ toOrganisationId: null }, { toOrganisationId: { in: chainIds } }],
  };
}

/** その人が見てよいお知らせか（1 件を開くとき）。編集できる人には下書きも宛先の外も見える */
export function canSeeNews(
  actor: Actor,
  chainIds: string[],
  n: Pick<News, "authorId" | "status" | "toOrganisationId">,
): boolean {
  if (canEditNews(actor, n.authorId)) return true;
  if (n.status !== "PUBLISHED") return false;
  return n.toOrganisationId === null || chainIds.includes(n.toOrganisationId);
}

/**
 * 差出元・宛先として選べるかを確かめる。だめなら文言を返す。
 * `choiceIds` は選べる組織（自分の組織とその上のうち、無効でないもの。`newsChoices`）。
 * 直すときは、いま付いている値はそのまま残してよい（異動したあと・管理する人が他人の分を直すとき・あとで無効にした組織）
 */
export function checkNewsOrganisations(
  actor: Actor,
  choiceIds: string[],
  v: { fromOrganisationId: string; toOrganisationId: string | null },
  current: { fromOrganisationId: string | null; toOrganisationId: string | null } | null,
  m: { orgNotAllowed: string; allNotAllowed: string },
): string | null {
  const keep = (id: string | null, now: string | null | undefined) =>
    current !== null && id === now;
  if (
    !choiceIds.includes(v.fromOrganisationId) &&
    !keep(v.fromOrganisationId, current?.fromOrganisationId)
  ) {
    return m.orgNotAllowed;
  }
  if (v.toOrganisationId === null) {
    if (!actor.has("NEWS_MANAGE") && !keep(null, current?.toOrganisationId)) return m.allNotAllowed;
  } else if (
    !choiceIds.includes(v.toOrganisationId) &&
    !keep(v.toOrganisationId, current?.toOrganisationId)
  ) {
    return m.orgNotAllowed;
  }
  return null;
}
