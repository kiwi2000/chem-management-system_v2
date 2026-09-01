import type { ConditionalLinkMode } from "@chem/shared";
import { prisma } from "@/lib/db";
import { isAdopted, winningRank } from "@/lib/link-priority";
import { judge, type ElementFactors, type JudgeEntry, type JudgeResult } from "@/lib/judge-calc";
import { getAppSettings } from "@/lib/settings";

/**
 * 判定の読み出しと保存。
 *
 * 計算そのものは judge-calc.ts にある（データベースを知らない形にしてある）。
 * こちらは、法律側の決めごとを集めて渡し、結果を保持する。
 */

/**
 * 備考に付けた目印。閾値を入れるときに書き込んだもの。
 * ここを見て「閾値を決められなかった」ことを判定へ伝える。
 *
 * **濃度のほかの条件は、備考ではなく「適用条件」の欄で持つ**
 * （備考には取り込み元の付随情報が入っており、目印では扱いきれないため）
 */
export const MARK_UNFILLED = "【閾値未設定】";

/**
 * CASリンクの備考に付けた目印（`scripts/seed-cas-links.ts` が書く）。
 *
 * 外部データベースが総称から個々の異性体へ広げ、
 * 「法律の名称が定める条件に合致すること」と但し書きを付けたもの。
 * 扱いはシステム設定 `judgment.conditional_link_mode` で決まる（第4章 4-3a）。
 */
export const MARK_CONDITIONAL_LINK = "政令の名称が定める条件に合うかは要確認";

/**
 * 判定に使う法律側のひとそろい。
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
 * そのバージョンで有効な法律側の決めごとを、区分ごとに組み立てる。
 *
 * CAS の紐づけは**打ち消されたもの（excluded）を除く**。
 * 優先度の高いデータソースが下位を打ち消すための仕組みなので、
 * ここで拾ってしまうと打ち消しが効かない。
 */
export async function loadRules(versionId: string): Promise<CategoryRule[]> {
  const categories = await prisma.regulationCategory.findMany({
    // 「判定に使う」印の付いた区分だけ。印の無いものは、持っているだけで判定に出さない
    where: { deletedAt: null, judged: true },
    select: {
      id: true,
      aggregation: true,
      metalEtc: true,
      thresholdBasis: true,
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
              applicableCondition: true,
              note: true,
              aggregation: true,
              metalEtc: true,
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
    select: {
      statutorySubstanceId: true,
      casNormalized: true,
      note: true,
      sourceId: true,
    },
  });

  /** データソースの優先度。**小さいほど優先** */
  const order = new Map(
    (
      await prisma.linkVersionSource.findMany({
        where: { versionId },
        orderBy: { priority: "asc" },
        select: { sourceId: true },
      })
    ).map((v, i) => [v.sourceId, i]),
  );

  /** 法文物質名 → その区分。勝ち負けを区分ごとに決めるために要る */
  const categoryOf = new Map<string, string>();
  for (const c of categories) {
    for (const cl of c.classes) {
      for (const sub of cl.statutorySubstances) categoryOf.set(sub.id, c.id);
    }
  }

  /*
    勝つデータソースは「規制区分 × CAS」で1つだけ。
    決めかたは lib/link-priority.ts にまとめてある（4か所で同じ答えにするため）
  */
  const priced = links.flatMap((l) => {
    const categoryId = categoryOf.get(l.statutorySubstanceId);
    return categoryId ? [{ ...l, categoryId }] : [];
  });
  const winner = winningRank(priced, order);

  const casOf = new Map<string, string[]>();
  /** 法文物質名 → CAS → その結び付きを持っているデータソース（勝ったものだけ） */
  const sourcesOf = new Map<string, Record<string, string[]>>();
  /** 条件つきで結ばれた CAS。法文物質名ごとに持つ */
  const conditionalOf = new Map<string, string[]>();
  for (const l of priced) {
    // 負けたデータソースの結び付きは、判定でも見ない
    if (!isAdopted(l, order, winner)) continue;

    const list = casOf.get(l.statutorySubstanceId);
    if (list) {
      if (!list.includes(l.casNormalized)) list.push(l.casNormalized);
    } else {
      casOf.set(l.statutorySubstanceId, [l.casNormalized]);
    }
    const bySub = sourcesOf.get(l.statutorySubstanceId) ?? {};
    // 勝つのは1つだけなので、ここに並ぶのも1つ
    bySub[l.casNormalized] = [l.sourceId];
    sourcesOf.set(l.statutorySubstanceId, bySub);

    if (l.note?.includes(MARK_CONDITIONAL_LINK)) {
      const c = conditionalOf.get(l.statutorySubstanceId);
      if (c) {
        if (!c.includes(l.casNormalized)) c.push(l.casNormalized);
      } else {
        conditionalOf.set(l.statutorySubstanceId, [l.casNormalized]);
      }
    }
  }

  return categories.map((c) => ({
    categoryId: c.id,
    category: {
      aggregation: c.aggregation,
      metalEtc: c.metalEtc,
      // 均質材料あたりの区分は、判定を出しても必ず要確認になる
      thresholdBasis: c.thresholdBasis,
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
        sourcesOf: sourcesOf.get(s.id) ?? {},
        aggregation: s.aggregation,
        metalEtc: s.metalEtc,
        threshold: {
          lower: s.thresholdLower.toString(),
          lowerBound: s.lowerBound,
          upper: s.thresholdUpper.toString(),
          upperBound: s.upperBound,
        },
        /*
          **適用条件が書いてあれば、当たったときは必ず要確認。**
          条件は法律の側で決まっているので、
          どのデータソースから結び付いたか・どのバージョンかでは変わらない
        */
        conditional: (s.applicableCondition ?? "").trim() !== "",
        conditionalCas: conditionalOf.get(s.id) ?? [],
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
  /**
   * 条件つきのCASリンクの扱い。省くとシステム設定を読む。
   * **全製品をやり直すときは呼ぶ側で1回だけ読んで渡す**（製品ごとに引くと無駄）
   */
  conditionalLinkMode?: ConditionalLinkMode,
): Promise<{ applicable: number; needsReview: number }> {
  const linkMode = conditionalLinkMode ?? (await getAppSettings()).conditionalLinkMode;
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
      conditionalLinkMode: linkMode,
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
          hits: { create: result.hits.map((h) => ({ ...h, contributions: h.contributions })) },
        },
      }),
    ),
  ]);

  return {
    applicable: results.filter((r) => r.result.verdict === "APPLICABLE").length,
    needsReview: results.filter((r) => r.result.needsReview).length,
  };
}
