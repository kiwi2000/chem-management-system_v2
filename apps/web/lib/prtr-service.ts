import type {
  Organisation,
  PrtrGroup,
  PrtrIndustry,
  PrtrMinister,
  PrtrRegistrant,
  PrtrSite,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import type {
  PrtrGroupDto,
  PrtrIndustryDto,
  PrtrMinisterDto,
  PrtrRegistrantDto,
  PrtrSiteDto,
} from "@/lib/types";

/**
 * PRTR（S22）のマスタ。工場 → グループ → 会社の 3 段。
 *
 * ここは DTO への詰め替えと、消してよいかの判断に要る件数だけ。
 * 担当の範囲（誰がどこまで見られるか）は lib/authz.ts の `prtrScopeOf` / `requirePrtrScope`
 */

export type PrtrGroupWithCounts = PrtrGroup & { _count: { sites: number; scopes: number } };

export function toPrtrGroupDto(g: PrtrGroupWithCounts): PrtrGroupDto {
  return {
    id: g.id,
    code: g.code,
    nameJa: g.nameJa,
    nameKana: g.nameKana,
    nameEn: g.nameEn,
    zip: g.zip,
    prefecture: g.prefecture,
    city: g.city,
    town: g.town,
    prefectureKana: g.prefectureKana,
    cityKana: g.cityKana,
    townKana: g.townKana,
    employeeNum: g.employeeNum,
    displayOrder: g.displayOrder,
    note: g.note,
    siteCount: g._count.sites,
    userCount: g._count.scopes,
    updatedAt: g.updatedAt.toISOString(),
  };
}

/** 一覧・詳細で毎回同じものを読む。消した工場は数えない */
export const PRTR_GROUP_INCLUDE = {
  _count: { select: { sites: { where: { deletedAt: null } }, scopes: true } },
} as const;

export type PrtrSiteWithGroup = PrtrSite & {
  group: Pick<PrtrGroup, "code" | "nameJa" | "nameEn">;
  _count: { scopes: number };
};

export function toPrtrSiteDto(s: PrtrSiteWithGroup): PrtrSiteDto {
  return {
    id: s.id,
    code: s.code,
    nameJa: s.nameJa,
    nameEn: s.nameEn,
    groupId: s.groupId,
    groupCode: s.group.code,
    groupNameJa: s.group.nameJa,
    groupNameEn: s.group.nameEn,
    displayOrder: s.displayOrder,
    note: s.note,
    userCount: s._count.scopes,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export const PRTR_SITE_INCLUDE = {
  group: { select: { code: true, nameJa: true, nameEn: true } },
  _count: { select: { scopes: true } },
} as const;

export function toPrtrIndustryDto(
  i: PrtrIndustry & { defaultMinister: Pick<PrtrMinister, "name"> | null },
): PrtrIndustryDto {
  return {
    id: i.id,
    code: i.code,
    name: i.name,
    defaultMinisterId: i.defaultMinisterId,
    defaultMinisterName: i.defaultMinister?.name ?? null,
    displayOrder: i.displayOrder,
    active: i.active,
  };
}

export function toPrtrMinisterDto(
  x: PrtrMinister & { _count: { industries: number } },
): PrtrMinisterDto {
  return {
    id: x.id,
    name: x.name,
    displayOrder: x.displayOrder,
    active: x.active,
    industryCount: x._count.industries,
  };
}

/**
 * 事業者。組織マスタの「会社」全部を、届出者の項目の有無に関わらず返す
 * （まだ入れていない会社も選べるようにするため）
 */
export function toPrtrRegistrantDto(
  o: Pick<Organisation, "id" | "code" | "nameJa" | "nameEn"> & {
    prtrRegistrant: PrtrRegistrant | null;
  },
  defaultOrganisationId: string,
): PrtrRegistrantDto {
  const r = o.prtrRegistrant;
  return {
    organisationId: o.id,
    organisationCode: o.code,
    organisationNameJa: o.nameJa,
    organisationNameEn: o.nameEn,
    isDefault: o.id === defaultOrganisationId,
    hasDetails: r !== null,
    nameKana: r?.nameKana ?? null,
    representName: r?.representName ?? null,
    representNameKana: r?.representNameKana ?? null,
    agentName: r?.agentName ?? null,
    agentNameKana: r?.agentNameKana ?? null,
    corporateNumber: r?.corporateNumber ?? null,
    lastYearCompanyName: r?.lastYearCompanyName ?? null,
    zip: r?.zip ?? null,
    prefecture: r?.prefecture ?? null,
    city: r?.city ?? null,
    town: r?.town ?? null,
    prefectureKana: r?.prefectureKana ?? null,
    cityKana: r?.cityKana ?? null,
    townKana: r?.townKana ?? null,
  };
}

/** 次の表示順（末尾に足す） */
export async function nextDisplayOrder(
  table: "prtrGroup" | "prtrSite" | "prtrIndustry" | "prtrMinister",
): Promise<number> {
  const last =
    table === "prtrGroup"
      ? await prisma.prtrGroup.findFirst({
          where: { deletedAt: null },
          orderBy: { displayOrder: "desc" },
          select: { displayOrder: true },
        })
      : table === "prtrSite"
        ? await prisma.prtrSite.findFirst({
            where: { deletedAt: null },
            orderBy: { displayOrder: "desc" },
            select: { displayOrder: true },
          })
        : table === "prtrIndustry"
          ? await prisma.prtrIndustry.findFirst({
              where: { deletedAt: null },
              orderBy: { displayOrder: "desc" },
              select: { displayOrder: true },
            })
          : await prisma.prtrMinister.findFirst({
              where: { deletedAt: null },
              orderBy: { displayOrder: "desc" },
              select: { displayOrder: true },
            });
  return (last?.displayOrder ?? 0) + 1;
}
