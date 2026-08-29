import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type {
  LawDto,
  RegulationCategoryDto,
  RegulationClassDto,
  StatutorySubstanceDto,
} from "@/lib/types";

/**
 * 法規制マスタ（法律 → 区分 → 分類 → 法文物質名）を画面へ渡す形に直す。
 *
 * どの段でも「消してよいか」を画面で判断できるよう、配下の件数を数えて返す。
 */

export const LAW_INCLUDE = {
  // 地域は国の1つ上。法律の一覧に出すので、国と一緒に引く
  country: {
    select: {
      nameJa: true,
      nameEn: true,
      region: { select: { id: true, nameJa: true, nameEn: true } },
    },
  },
  _count: { select: { categories: { where: { deletedAt: null } } } },
} satisfies Prisma.LawInclude;

type LawRow = Prisma.LawGetPayload<{ include: typeof LAW_INCLUDE }>;

export function toLawDto(l: LawRow): LawDto {
  return {
    id: l.id,
    code: l.code,
    countryId: l.countryId,
    countryNameJa: l.country.nameJa,
    countryNameEn: l.country.nameEn,
    regionId: l.country.region.id,
    regionNameJa: l.country.region.nameJa,
    regionNameEn: l.country.region.nameEn,
    nameOriginal: l.nameOriginal,
    nameLang: l.nameLang,
    nameJa: l.nameJa,
    nameEn: l.nameEn,
    displayOrder: l.displayOrder,
    note: l.note,
    categoryCount: l._count.categories,
  };
}

/**
 * 区分の配下の法文物質名の数。
 * 分類を1段はさむので Prisma の _count では数えられず、まとめて引いてから配る。
 */
export async function countSubstancesByCategory(
  categoryIds: string[],
): Promise<Map<string, number>> {
  if (categoryIds.length === 0) return new Map();
  const rows = await prisma.regulationClass.findMany({
    where: { categoryId: { in: categoryIds }, deletedAt: null },
    select: {
      categoryId: true,
      _count: { select: { statutorySubstances: { where: { deletedAt: null } } } },
    },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.categoryId, (out.get(r.categoryId) ?? 0) + r._count.statutorySubstances);
  }
  return out;
}

type CategoryRow = Prisma.RegulationCategoryGetPayload<object>;

export function toCategoryDto(c: CategoryRow, substanceCount: number): RegulationCategoryDto {
  return {
    id: c.id,
    code: c.code,
    lawId: c.lawId,
    nameOriginal: c.nameOriginal,
    nameLang: c.nameLang,
    nameJa: c.nameJa,
    nameEn: c.nameEn,
    thresholdLower: c.thresholdLower.toString(),
    lowerBound: c.lowerBound,
    thresholdUpper: c.thresholdUpper.toString(),
    upperBound: c.upperBound,
    interactionGroup: c.interactionGroup,
    rank: c.rank,
    thresholdBasis: c.thresholdBasis,
    displayOrder: c.displayOrder,
    note: c.note,
    substanceCount,
  };
}

export const CLASS_INCLUDE = {
  _count: { select: { statutorySubstances: { where: { deletedAt: null } } } },
} satisfies Prisma.RegulationClassInclude;

type ClassRow = Prisma.RegulationClassGetPayload<{ include: typeof CLASS_INCLUDE }>;

export function toClassDto(c: ClassRow): RegulationClassDto {
  return {
    id: c.id,
    code: c.code,
    categoryId: c.categoryId,
    nameOriginal: c.nameOriginal,
    nameLang: c.nameLang,
    nameJa: c.nameJa,
    nameEn: c.nameEn,
    displayOrder: c.displayOrder,
    substanceCount: c._count.statutorySubstances,
  };
}

export const SUBSTANCE_INCLUDE = {
  _count: { select: { links: true } },
} satisfies Prisma.StatutorySubstanceInclude;

type SubstanceRow = Prisma.StatutorySubstanceGetPayload<{ include: typeof SUBSTANCE_INCLUDE }>;

/** 日付は日だけ使うので、時刻を持たない形（YYYY-MM-DD）で渡す */
const toDate = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null);

export function toStatutorySubstanceDto(s: SubstanceRow): StatutorySubstanceDto {
  return {
    id: s.id,
    code: s.code,
    classId: s.classId,
    officialNumber: s.officialNumber,
    nameOriginal: s.nameOriginal,
    nameLang: s.nameLang,
    nameJa: s.nameJa,
    nameEn: s.nameEn,
    thresholdLower: s.thresholdLower.toString(),
    lowerBound: s.lowerBound,
    thresholdUpper: s.thresholdUpper.toString(),
    upperBound: s.upperBound,
    effectiveFrom: toDate(s.effectiveFrom),
    effectiveTo: toDate(s.effectiveTo),
    displayOrder: s.displayOrder,
    applicableCondition: s.applicableCondition,
    note: s.note,
    casCount: s._count.links,
  };
}

/**
 * 区分は、名前のない分類を必ず1件持つ。
 * 法文物質名の親を常に分類にしておくと外部キーが1本で済み、
 * 後から分けたくなっても既存のぶら下がりを動かさずに名前を付けるだけで足りる。
 */
export async function ensureDefaultClass(categoryId: string, actorId: string): Promise<void> {
  const count = await prisma.regulationClass.count({ where: { categoryId, deletedAt: null } });
  if (count > 0) return;
  await prisma.regulationClass.create({
    data: {
      categoryId,
      code: "DEFAULT",
      codeNormalized: "DEFAULT",
      nameOriginal: null,
      nameLang: null,
      displayOrder: 0,
      createdBy: actorId,
      updatedBy: actorId,
    },
  });
}
