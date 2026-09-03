import type { Group } from "@prisma/client";
import type { GroupDto } from "@/lib/types";

type WithCount = Group & {
  _count: { newsMembers: number; news: number };
};

/**
 * 所属人数はお知らせの分類（newsMembers）だけ数える。
 * 組織の所属は「組織」へ移した（2026-08-30）ので、ORG のグループに人は付かない
 */
export function toGroupDto(g: WithCount): GroupDto {
  return {
    id: g.id,
    kind: g.kind,
    nameJa: g.nameJa,
    nameEn: g.nameEn,
    displayOrder: g.displayOrder,
    activeFlag: g.activeFlag,
    memberCount: g._count.newsMembers,
    newsCount: g._count.news,
  };
}

/** 一覧・DTO化で毎回同じものを数えるので共通化する */
export const GROUP_COUNT_SELECT = {
  _count: { select: { newsMembers: true, news: true } },
} as const;
