import type { Group } from "@prisma/client";
import type { GroupDto } from "@/lib/types";

type WithCount = Group & {
  _count: { orgMembers: number; newsMembers: number; news: number };
};

/**
 * 所属人数は用途によって数える先が違う。
 * お知らせの分類は newsMembers、組織の所属は orgMembers を見る。
 */
export function toGroupDto(g: WithCount): GroupDto {
  return {
    id: g.id,
    kind: g.kind,
    nameJa: g.nameJa,
    nameEn: g.nameEn,
    displayOrder: g.displayOrder,
    activeFlag: g.activeFlag,
    memberCount: g.kind === "NEWS" ? g._count.newsMembers : g._count.orgMembers,
    newsCount: g._count.news,
  };
}

/** 一覧・DTO化で毎回同じものを数えるので共通化する */
export const GROUP_COUNT_SELECT = {
  _count: { select: { orgMembers: true, newsMembers: true, news: true } },
} as const;
