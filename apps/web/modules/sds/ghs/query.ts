import { prisma } from "@/lib/db";
import { classSortOrder } from "./catalog-data";

/**
 * 物質の詳細に出す、CAS ごとの GHS 分類（出どころ別）。判定対象日に有効な項目だけを引く。
 * 段 1 の混合物の計算も同じ引き方から始める（国ごとの採用規則はまだ無い）
 */

export interface GhsClassificationRow {
  hazardClass: string;
  classNameJa: string;
  classNameEn: string;
  category: string;
  categoryNameJa: string | null;
  categoryNameEn: string | null;
  status: "CLASSIFIED" | "NOT_CLASSIFIED" | "CANNOT_CLASSIFY" | "NOT_APPLICABLE" | "NOT_EVALUATED";
  hCodes: string | null;
  targetOrgans: string | null;
  ghsRevision: string | null;
  classifiedIn: string | null;
}

export interface GhsSourceBlock {
  sourceCode: string;
  sourceNameJa: string;
  sourceNameEn: string;
  /** 項目の名前（出どころが付けた物質名） */
  entryName: string;
  sourceKey: string;
  effectiveFrom: string;
  releaseLabel: string;
  rows: GhsClassificationRow[];
}

export async function classificationsForCas(
  casNormalized: string,
  asOf: string,
): Promise<GhsSourceBlock[]> {
  const day = new Date(`${asOf}T00:00:00Z`);
  const links = await prisma.sdsGhsEntryCas.findMany({
    where: {
      casNormalized,
      entry: {
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
    },
    include: {
      entry: {
        include: {
          source: { select: { code: true, nameJa: true, nameEn: true, sortOrder: true } },
          releaseIn: { select: { label: true } },
          classifications: true,
        },
      },
    },
  });
  if (links.length === 0) return [];
  const catalog = await prisma.sdsGhsHazardCatalog.findMany({
    select: { hazardClass: true, category: true, nameJa: true, nameEn: true },
  });
  const nameOf = new Map(catalog.map((c) => [`${c.hazardClass}|${c.category}`, c]));

  const blocks = links.map(({ entry }): GhsSourceBlock => ({
    sourceCode: entry.source.code,
    sourceNameJa: entry.source.nameJa,
    sourceNameEn: entry.source.nameEn,
    entryName: entry.name,
    sourceKey: entry.sourceKey + entry.subKey,
    effectiveFrom: entry.effectiveFrom.toISOString().slice(0, 10),
    releaseLabel: entry.releaseIn.label,
    rows: entry.classifications
      .map((c): GhsClassificationRow => {
        const cls = nameOf.get(`${c.hazardClass}|`);
        const cat = c.category ? nameOf.get(`${c.hazardClass}|${c.category}`) : undefined;
        return {
          hazardClass: c.hazardClass,
          classNameJa: cls?.nameJa ?? c.hazardClass,
          classNameEn: cls?.nameEn ?? c.hazardClass,
          category: c.category,
          categoryNameJa: cat?.nameJa ?? null,
          categoryNameEn: cat?.nameEn ?? null,
          status: c.status,
          hCodes: c.hCodes,
          targetOrgans: c.targetOrgans,
          ghsRevision: c.ghsRevision,
          classifiedIn: c.classifiedIn,
        };
      })
      .sort(
        (a, b) =>
          classSortOrder(a.hazardClass) - classSortOrder(b.hazardClass) ||
          a.category.localeCompare(b.category),
      ),
  }));
  return blocks.sort(
    (a, b) => a.sourceCode.localeCompare(b.sourceCode) || a.sourceKey.localeCompare(b.sourceKey),
  );
}
