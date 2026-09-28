import type { SdsGhsCasOrigin } from "@prisma/client";
import { prisma } from "@/lib/db";
import { classSortOrder } from "./catalog-data";

/**
 * 物質の詳細に出す、CAS ごとの GHS 分類（出どころ別）。判定対象日に有効な項目だけを引く。
 * 原典の CAS で当たる項目に加えて、結び付きの層（LOLI の展開など）で当たる項目も列にする（§9-4）。
 * 段 1 の混合物の計算も同じ引き方から始める
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
  /** 出典の文字列そのまま（該当しない・分類できない等は、出典の言葉で見せる） */
  rawClassText: string;
  /** 最小分類の印（EU の * ** ***） */
  minimumClassification: string | null;
}

export interface GhsClassDef {
  code: string;
  nameJa: string;
  nameEn: string;
}

/** カタログのクラス一覧（表示の並び順）。出典に載っていない項目を「記載なし」として並べるため */
export async function listGhsClasses(): Promise<GhsClassDef[]> {
  const rows = await prisma.sdsGhsHazardCatalog.findMany({
    where: { category: "" },
    orderBy: { sortOrder: "asc" },
    select: { hazardClass: true, nameJa: true, nameEn: true },
  });
  return rows.map((r) => ({ code: r.hazardClass, nameJa: r.nameJa, nameEn: r.nameEn }));
}

export interface GhsSourceBlock {
  sourceCode: string;
  sourceNameJa: string;
  sourceNameEn: string;
  /** 項目の名前（出どころが付けた物質名） */
  entryName: string;
  sourceKey: string;
  /** 枝番・条件・改正（列の見出しに出す） */
  subKey: string;
  conditionText: string | null;
  amendingAct: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** 判定対象日より後に効く項目（将来の ATP など） */
  isFuture: boolean;
  releaseLabel: string;
  /** 最後にこの物質が載っていた公表（＝この行が最新であることを確認した公表）とその取り込み日時 */
  lastSeenLabel: string;
  lastSeenPublishedOn: string;
  lastSeenImportedAt: string;
  /** この項目にどう結び付いたか。原典の CAS なら SOURCE。結び付きの層なら linkedBy にそのコード */
  linkOrigin: SdsGhsCasOrigin;
  linkedBy: string | null;
  linkNote: string | null;
  rows: GhsClassificationRow[];
}

const ENTRY_INCLUDE = {
  source: { select: { code: true, nameJa: true, nameEn: true, sortOrder: true } },
  releaseIn: { select: { label: true } },
  releaseLastSeen: { select: { label: true, publishedOn: true, importedAt: true } },
  classifications: true,
} as const;

export async function classificationsForCas(
  casNormalized: string,
  asOf: string,
  /** 使う結び付きの層（"LOLI" など）。原典は常に */
  linkLayers: ReadonlySet<string> = new Set(["LOLI"]),
): Promise<GhsSourceBlock[]> {
  const day = new Date(`${asOf}T00:00:00Z`);
  // いま効いている項目と、これから効く項目。閉じた項目（終了日が過去）は出さない
  const open = { OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }] };
  const links = await prisma.sdsGhsEntryCas.findMany({
    where: { casNormalized, entry: open },
    include: { entry: { include: ENTRY_INCLUDE } },
  });
  type Found = {
    entry: (typeof links)[number]["entry"];
    origin: SdsGhsCasOrigin;
    linkedBy: string | null;
    note: string | null;
  };
  const found: Found[] = links.map((l) => ({
    entry: l.entry,
    origin: "SOURCE",
    linkedBy: null,
    note: null,
  }));
  const seen = new Set(found.map((f) => f.entry.id));
  if (linkLayers.size > 0) {
    const keyLinks = await prisma.sdsGhsKeyLink.findMany({
      where: { casNormalized, linkedBy: { in: [...linkLayers] } },
      select: { sourceId: true, sourceKey: true, origin: true, linkedBy: true, note: true },
    });
    for (const k of keyLinks) {
      const entries = await prisma.sdsGhsEntry.findMany({
        where: { sourceId: k.sourceId, sourceKey: k.sourceKey, ...open },
        include: ENTRY_INCLUDE,
      });
      for (const e of entries) {
        if (seen.has(e.id)) continue; // 原典で既に結ばれている項目には重ねない
        seen.add(e.id);
        found.push({ entry: e, origin: k.origin, linkedBy: k.linkedBy, note: k.note });
      }
    }
  }
  if (found.length === 0) return [];
  const catalog = await prisma.sdsGhsHazardCatalog.findMany({
    select: { hazardClass: true, category: true, nameJa: true, nameEn: true },
  });
  const nameOf = new Map(catalog.map((c) => [`${c.hazardClass}|${c.category}`, c]));

  const blocks = found.map(({ entry, origin, linkedBy, note }): GhsSourceBlock => ({
    sourceCode: entry.source.code,
    sourceNameJa: entry.source.nameJa,
    sourceNameEn: entry.source.nameEn,
    entryName: entry.name,
    sourceKey: entry.sourceKey,
    subKey: entry.subKey,
    conditionText: entry.conditionText,
    amendingAct: entry.amendingAct,
    effectiveFrom: entry.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: entry.effectiveTo?.toISOString().slice(0, 10) ?? null,
    isFuture: entry.effectiveFrom > day,
    releaseLabel: entry.releaseIn.label,
    lastSeenLabel: entry.releaseLastSeen.label,
    lastSeenPublishedOn: entry.releaseLastSeen.publishedOn.toISOString().slice(0, 10),
    lastSeenImportedAt: entry.releaseLastSeen.importedAt.toISOString(),
    linkOrigin: origin,
    linkedBy,
    linkNote: note,
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
          rawClassText: c.rawClassText,
          minimumClassification: c.minimumClassification,
        };
      })
      .sort(
        (a, b) =>
          classSortOrder(a.hazardClass) - classSortOrder(b.hazardClass) ||
          a.category.localeCompare(b.category),
      ),
  }));
  const order = new Map(found.map(({ entry }) => [entry.source.code, entry.source.sortOrder]));
  // 出典の並び → 原典の結び付きが先 → 識別子
  return blocks.sort(
    (a, b) =>
      (order.get(a.sourceCode) ?? 0) - (order.get(b.sourceCode) ?? 0) ||
      Number(a.linkedBy !== null) - Number(b.linkedBy !== null) ||
      a.sourceKey.localeCompare(b.sourceKey) ||
      a.subKey.localeCompare(b.subKey) ||
      a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
}
