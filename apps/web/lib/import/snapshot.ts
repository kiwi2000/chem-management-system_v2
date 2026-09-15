/**
 * 法規制データの写し（スナップショット）を DB から取る。
 *
 * 顧客環境・当方の正規データ・次に渡す配布パッケージを、同じ形に写して突き合わせるための入れ物。
 * **鍵はコード**（法律 → 区分 → 分類 → 法文物質名 → 結び付きは バージョン×データソース×CAS）。
 * 内部の id は環境ごとに違うので持たない。名前は表示用の項目として持つ。
 *
 * 使うところ: tools/precheck（format = chem-precheck/1）と、データ入出力の「エクスポート」
 * （format = chem-data-set/1）。形は packages/shared/src/data-exchange/snapshot.ts（決定 0011）
 */
import type { PrismaClient } from "@prisma/client";
import { SNAPSHOT_FORMAT, type LinkSnap, type Snapshot, type SnapshotFormat } from "@chem/shared";

/** 地域・国・元素・金属換算係数。法律の親と、判定に要るもの。空の DB に取り込めるように写しに入れる */
async function takeMasters(prisma: PrismaClient) {
  const [regions, countries, elements, factors] = await Promise.all([
    prisma.region.findMany({
      where: { deletedAt: null },
      orderBy: { displayOrder: "asc" },
      select: { code: true, nameJa: true, nameEn: true, displayOrder: true },
    }),
    prisma.country.findMany({
      where: { deletedAt: null },
      orderBy: { displayOrder: "asc" },
      select: {
        code: true,
        nameJa: true,
        nameEn: true,
        displayOrder: true,
        region: { select: { code: true } },
      },
    }),
    prisma.element.findMany({
      where: { deletedAt: null },
      orderBy: { atomicNumber: "asc" },
      select: { symbol: true, atomicNumber: true, nameJa: true, nameEn: true },
    }),
    prisma.metalConversionFactor.findMany({
      where: { deletedAt: null },
      orderBy: [{ casNormalized: "asc" }, { metalElement: "asc" }],
      select: {
        casNumber: true,
        casNormalized: true,
        metalElement: true,
        ratioPct: true,
        note: true,
      },
    }),
  ]);
  return {
    regions: regions.map((r) => ({
      code: r.code,
      nameJa: r.nameJa,
      nameEn: r.nameEn,
      displayOrder: r.displayOrder,
    })),
    countries: countries.map((c) => ({
      code: c.code,
      regionCode: c.region.code,
      nameJa: c.nameJa,
      nameEn: c.nameEn,
      displayOrder: c.displayOrder,
    })),
    elements: elements.map((e) => ({
      symbol: e.symbol,
      atomicNumber: e.atomicNumber,
      nameJa: e.nameJa,
      nameEn: e.nameEn,
    })),
    metalFactors: factors.map((f) => ({
      cas: f.casNormalized,
      casNumber: f.casNumber,
      element: f.metalElement,
      ratioPct: f.ratioPct.toString(),
      note: f.note,
    })),
  };
}

const day = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null);

/**
 * データベースから写しを取る。消したもの（deletedAt あり）は入れない。
 * 結び付きは件数が多い（数十万）ので、id の順に区切って読む
 */
export async function takeSnapshot(
  prisma: PrismaClient,
  label: string,
  format: SnapshotFormat = SNAPSHOT_FORMAT,
): Promise<Snapshot> {
  const [versions, sources, laws] = await Promise.all([
    prisma.linkSetVersion.findMany({
      where: { deletedAt: null },
      orderBy: { asOf: "asc" },
      select: { id: true, code: true, asOf: true, isCurrent: true },
    }),
    prisma.source.findMany({
      where: { deletedAt: null },
      orderBy: { code: "asc" },
      select: { id: true, code: true },
    }),
    prisma.law.findMany({
      where: { deletedAt: null },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        nameOriginal: true,
        nameLang: true,
        nameJa: true,
        nameEn: true,
        displayOrder: true,
        note: true,
        country: { select: { code: true } },
        categories: {
          where: { deletedAt: null },
          orderBy: { displayOrder: "asc" },
          select: {
            id: true,
            code: true,
            nameOriginal: true,
            nameLang: true,
            nameJa: true,
            nameEn: true,
            displayOrder: true,
            thresholdLower: true,
            lowerBound: true,
            thresholdUpper: true,
            upperBound: true,
            aggregation: true,
            metalEtc: true,
            thresholdBasis: true,
            judged: true,
            effectiveFrom: true,
            effectiveTo: true,
            interactionGroup: true,
            rank: true,
            score: true,
            note: true,
            classes: {
              where: { deletedAt: null },
              orderBy: { displayOrder: "asc" },
              select: {
                id: true,
                code: true,
                nameOriginal: true,
                nameLang: true,
                nameJa: true,
                nameEn: true,
                displayOrder: true,
                interactionGroup: true,
                rank: true,
                note: true,
                statutorySubstances: {
                  where: { deletedAt: null },
                  orderBy: { displayOrder: "asc" },
                  select: {
                    id: true,
                    code: true,
                    officialNumber: true,
                    nameOriginal: true,
                    nameLang: true,
                    nameJa: true,
                    nameEn: true,
                    displayOrder: true,
                    thresholdLower: true,
                    lowerBound: true,
                    thresholdUpper: true,
                    upperBound: true,
                    aggregation: true,
                    metalEtc: true,
                    effectiveFrom: true,
                    effectiveTo: true,
                    applicableCondition: true,
                    note: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const versionCode = new Map(versions.map((v) => [v.id, v.code]));
  const sourceCode = new Map(sources.map((s) => [s.id, s.code]));

  // 結び付きを法文物質名ごとにまとめる
  const linksOf = new Map<string, LinkSnap[]>();
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.statutoryCasLink.findMany({
      take: 20000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        statutorySubstanceId: true,
        versionId: true,
        sourceId: true,
        casNumber: true,
        casNormalized: true,
        excluded: true,
        note: true,
        data: { select: { text: true, textJa: true } },
      },
    });
    for (const r of rows) {
      const list = linksOf.get(r.statutorySubstanceId) ?? [];
      list.push({
        version: versionCode.get(r.versionId) ?? r.versionId,
        source: sourceCode.get(r.sourceId) ?? r.sourceId,
        cas: r.casNormalized,
        casNumber: r.casNumber,
        excluded: r.excluded,
        note: r.note,
        text: r.data?.text ?? null,
        textJa: r.data?.textJa ?? null,
      });
      linksOf.set(r.statutorySubstanceId, list);
    }
    if (rows.length < 20000) break;
    cursor = rows[rows.length - 1]?.id;
  }

  const masters = await takeMasters(prisma);
  return {
    format,
    takenAt: new Date().toISOString(),
    label,
    ...masters,
    versions: versions.map((v) => ({
      code: v.code,
      asOf: day(v.asOf) ?? "",
      isCurrent: v.isCurrent,
    })),
    sources: sources.map((s) => ({ code: s.code })),
    laws: laws.map((l) => ({
      code: l.code,
      countryCode: l.country.code,
      nameOriginal: l.nameOriginal,
      nameLang: l.nameLang,
      nameJa: l.nameJa,
      nameEn: l.nameEn,
      displayOrder: l.displayOrder,
      note: l.note,
      categories: l.categories.map((c) => ({
        code: c.code,
        nameOriginal: c.nameOriginal,
        nameLang: c.nameLang,
        nameJa: c.nameJa,
        nameEn: c.nameEn,
        displayOrder: c.displayOrder,
        thresholdLower: c.thresholdLower.toString(),
        lowerBound: c.lowerBound,
        thresholdUpper: c.thresholdUpper.toString(),
        upperBound: c.upperBound,
        aggregation: c.aggregation,
        metalEtc: c.metalEtc,
        thresholdBasis: c.thresholdBasis,
        judged: c.judged,
        effectiveFrom: day(c.effectiveFrom),
        effectiveTo: day(c.effectiveTo),
        interactionGroup: c.interactionGroup,
        rank: c.rank,
        score: c.score.toString(),
        note: c.note,
        classes: c.classes.map((k) => ({
          code: k.code,
          nameOriginal: k.nameOriginal,
          nameLang: k.nameLang,
          nameJa: k.nameJa,
          nameEn: k.nameEn,
          displayOrder: k.displayOrder,
          interactionGroup: k.interactionGroup,
          rank: k.rank,
          note: k.note,
          substances: k.statutorySubstances.map((s) => ({
            code: s.code,
            officialNumber: s.officialNumber,
            nameOriginal: s.nameOriginal,
            nameLang: s.nameLang,
            nameJa: s.nameJa,
            nameEn: s.nameEn,
            displayOrder: s.displayOrder,
            thresholdLower: s.thresholdLower.toString(),
            lowerBound: s.lowerBound,
            thresholdUpper: s.thresholdUpper.toString(),
            upperBound: s.upperBound,
            aggregation: s.aggregation,
            metalEtc: s.metalEtc,
            effectiveFrom: day(s.effectiveFrom),
            effectiveTo: day(s.effectiveTo),
            applicableCondition: s.applicableCondition,
            note: s.note,
            links: (linksOf.get(s.id) ?? []).sort((a, b) =>
              `${a.version}/${a.source}/${a.cas}`.localeCompare(
                `${b.version}/${b.source}/${b.cas}`,
              ),
            ),
          })),
        })),
      })),
    })),
  };
}
