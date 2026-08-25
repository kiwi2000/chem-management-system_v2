import { prisma } from "@/lib/db";
import { judge, type ElementFactors, type JudgeEntry, type JudgeResult } from "@/lib/judge-calc";

/**
 * 判定の読み出しと保存。
 *
 * 計算そのものは judge-calc.ts にある（データベースを知らない形にしてある）。
 * こちらは、法令側の決めごとを集めて渡し、結果を保持する。
 */

/**
 * 備考に付けた目印。閾値を入れるときに書き込んだもの。
 * ここを見て「濃度だけでは決められない」ことを判定へ伝える。
 */
const MARK_CONDITIONAL = "【条件つき除外】";
const MARK_UNFILLED = "【閾値未設定】";

/**
 * 判定に使う法令側のひとそろい。
 *
 * **区分ごとにまとめて読み出す。**製品1件ずつ引くと、
 * 全製品を判定するときに同じものを何千回も引くことになる。
 */
export interface CategoryRule {
  categoryId: string;
  category: Parameters<typeof judge>[0]["category"];
  entries: JudgeEntry[];
}

/**
 * その版で有効な法令側の決めごとを、区分ごとに組み立てる。
 *
 * CAS の紐づけは**打ち消されたもの（excluded）を除く**。
 * 優先度の高いデータソースが下位を打ち消すための仕組みなので、
 * ここで拾ってしまうと打ち消しが効かない。
 */
export async function loadRules(versionId: string): Promise<CategoryRule[]> {
  const categories = await prisma.regulationCategory.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      aggregation: true,
      aggregationElement: true,
      thresholdLower: true,
      lowerBound: true,
      thresholdUpper: true,
      upperBound: true,
      classes: {
        where: { deletedAt: null },
        select: {
          statutorySubstances: {
            where: { deletedAt: null },
            select: {
              id: true,
              note: true,
              aggregation: true,
              aggregationElement: true,
              thresholdLower: true,
              lowerBound: true,
              thresholdUpper: true,
              upperBound: true,
            },
          },
        },
      },
    },
  });

  // CAS の紐づけは、法文物質名ごとにまとめて引く（1件ずつ引くと問い合わせが爆発する）
  const links = await prisma.statutoryCasLink.findMany({
    where: { versionId, excluded: false },
    select: { statutorySubstanceId: true, casNormalized: true },
  });
  const casOf = new Map<string, string[]>();
  for (const l of links) {
    const list = casOf.get(l.statutorySubstanceId);
    if (list) list.push(l.casNormalized);
    else casOf.set(l.statutorySubstanceId, [l.casNormalized]);
  }

  return categories.map((c) => ({
    categoryId: c.id,
    category: {
      aggregation: c.aggregation,
      aggregationElement: c.aggregationElement,
      threshold: {
        lower: c.thresholdLower.toString(),
        lowerBound: c.lowerBound,
        upper: c.thresholdUpper.toString(),
        upperBound: c.upperBound,
      },
    },
    entries: c.classes.flatMap((cl) =>
      cl.statutorySubstances.map((s) => ({
        id: s.id,
        cas: casOf.get(s.id) ?? [],
        aggregation: s.aggregation,
        aggregationElement: s.aggregationElement,
        threshold: {
          lower: s.thresholdLower.toString(),
          lowerBound: s.lowerBound,
          upper: s.thresholdUpper.toString(),
          upperBound: s.upperBound,
        },
        conditional: s.note?.includes(MARK_CONDITIONAL) ?? false,
        unfilled: s.note?.includes(MARK_UNFILLED) ?? false,
      })),
    ),
  }));
}

/** 金属換算係数を、CAS で引ける形にする */
export async function loadFactors(): Promise<ElementFactors> {
  const rows = await prisma.metalConversionFactor.findMany({
    where: { deletedAt: null },
    select: { casNormalized: true, metalElement: true, ratioPct: true },
  });
  const out: ElementFactors = new Map();
  for (const r of rows) {
    const list = out.get(r.casNormalized) ?? [];
    list.push({ element: r.metalElement, ratioPct: r.ratioPct.toString() });
    out.set(r.casNormalized, list);
  }
  return out;
}

/**
 * 1製品を、すべての区分について judge し、結果を保持する。
 *
 * **前の判定は行ごと消す。**確認済みの状態も上書きも残さない。
 * 判定をやり直すのは、新しい製品を判定するのと同じこと。
 * 前の確認結果だけが残るのは筋が通らない。
 * 「いつ誰が何をしたか」はアクセス記録の側に残るので、追うことはできる。
 */
export async function judgeProduct(
  productId: string,
  rules: CategoryRule[],
  factors: ElementFactors,
): Promise<{ applicable: number; needsReview: number }> {
  const expansion = await prisma.productExpansion.findUnique({
    where: { productId },
    select: { unknownPct: true, truncated: true },
  });
  const lines = await prisma.productExpansionLine.findMany({
    where: { productId },
    select: { casNormalized: true, substanceId: true, totalPct: true },
  });

  /*
    展開結果がまだ無い製品は、中身が何も分からないのと同じ。
    「非該当」と言い切らず、全部が分からないぶんとして扱う。
  */
  const unknownPct = expansion ? expansion.unknownPct.toString() : "100";
  const truncated = expansion?.truncated ?? 0;

  const results: { rule: CategoryRule; result: JudgeResult }[] = rules.map((rule) => ({
    rule,
    result: judge({
      lines: lines.map((l) => ({
        casNormalized: l.casNormalized,
        substanceId: l.substanceId,
        totalPct: l.totalPct.toString(),
      })),
      unknownPct,
      truncated,
      category: rule.category,
      entries: rule.entries,
      factors,
    }),
  }));

  await prisma.$transaction([
    // 前の判定は、確認済みの状態ごと捨てる
    prisma.productJudgement.deleteMany({ where: { productId } }),
    ...results.map(({ rule, result }) =>
      prisma.productJudgement.create({
        data: {
          productId,
          categoryId: rule.categoryId,
          verdict: result.verdict,
          source: "SYSTEM",
          needsReview: result.needsReview,
          reviewReasons: result.reasons,
          hits: { create: result.hits.map((h) => ({ ...h })) },
        },
      }),
    ),
  ]);

  return {
    applicable: results.filter((r) => r.result.verdict === "APPLICABLE").length,
    needsReview: results.filter((r) => r.result.needsReview).length,
  };
}
