import { fromScaled, toScaled } from "@chem/shared";

/**
 * 法規制の判定。**ここはデータベースを知らない。**
 *
 * 展開済みの組成（製品 × CAS × 合計含有率）と、法令側の決めごとを受け取って、
 * 該当か非該当かを出す。読み出しと保存は judge-store.ts の側。
 *
 * 判定は2つに分けて返す。
 *
 *   verdict     … 該当 ／ 非該当。**必ずどちらか**
 *   needsReview … 人が見なければ決められない、という印。判定とは別に持つ
 *
 * 「答えは何か」と「人が見たかどうか」は別の話なので、混ぜない。
 * 混ぜると、確認しても判定が変わらない場合に置き場所が無くなる。
 *
 * **判断できないものは「該当」に倒す。**
 * 見落とすより、余分に拾うほうが安全なため（拾いすぎても手間が増えるだけだが、
 * 見落とすとそのまま出荷して違反になる）。
 */

/** まとめかた。schema の AggregationMode と同じ */
export type Aggregation = "NONE" | "SUM" | "ELEMENT";

/** 閾値の境目。schema の ThresholdBound と同じ */
export type Bound = "INCLUSIVE" | "EXCLUSIVE";

export interface Threshold {
  lower: string;
  lowerBound: Bound;
  upper: string;
  upperBound: Bound;
}

/** 展開済みの組成の1行 */
export interface ExpandedLine {
  casNormalized: string | null;
  substanceId: string | null;
  totalPct: string;
}

/** 判定の対象になる法文物質名 */
export interface JudgeEntry {
  id: string;
  /** この法文物質名に紐づく CAS（打ち消されたものは除いてある） */
  cas: string[];
  aggregation: Aggregation;
  /** 元素換算でまとめるときの元素記号 */
  aggregationElement: string | null;
  threshold: Threshold;
  /** 濃度のほかに条件が付く（備考に印がある）。当たったら要確認にする */
  conditional: boolean;
  /** 閾値を入れられなかった（備考に印がある）。当たったら要確認にする */
  unfilled: boolean;
}

export interface JudgeCategory {
  aggregation: Aggregation;
  aggregationElement: string | null;
  threshold: Threshold;
}

/** 金属換算係数。CAS → その中の元素の重量％ */
export type ElementFactors = Map<string, { element: string; ratioPct: string }[]>;

export interface JudgeInput {
  lines: ExpandedLine[];
  /** 中身が分からないまま残ったぶん */
  unknownPct: string;
  /** 深さの上限で打ち切った枝の数 */
  truncated: number;
  category: JudgeCategory;
  entries: JudgeEntry[];
  factors: ElementFactors;
}

/** 要確認にした理由。文言は画面側で付ける */
export type ReviewReason =
  /** 中身の分からない原材料が残っている */
  | "unknownComposition"
  /** 深すぎて展開しきれなかった */
  | "truncated"
  /** 当たった法文物質名に、濃度以外の条件が付いている */
  | "conditionalExclusion"
  /** 閾値を入れられていない法文物質名に、当たる物質が入っている */
  | "unfilledThreshold";

export interface JudgeHit {
  /** 当たった法文物質名。区分でまとめたときは null（区分そのものが当たった） */
  statutorySubstanceId: string | null;
  /**
   * 合算した含有率。**まとめたときだけ入る。**
   * まとめないときは CAS ごとに別々に比べているので、合計には意味が無い。
   * そこに数字を入れると、足していないものを足したように読まれてしまう
   */
  total: string | null;
  /**
   * 当たった CAS と、それぞれの含有率。
   *
   *   まとめない … **個別に閾値を超えた CAS が、すべて並ぶ**
   *   まとめる   … 足し合わせた CAS が、すべて並ぶ（元素換算なら換算後の値）
   */
  contributions: { cas: string; pct: string }[];
}

export interface JudgeResult {
  verdict: "APPLICABLE" | "NOT_APPLICABLE";
  needsReview: boolean;
  reasons: ReviewReason[];
  hits: JudgeHit[];
}

/**
 * 閾値の中に入っているか。
 *
 * 「〇・一％以下を除く」は 下限 0.1（超える）〜 上限 100（含む）として入っている。
 * 境目を含むか含まないかで答えが変わるので、必ず境目の指定を見る。
 */
function within(pct: bigint, t: Threshold): boolean {
  const lower = toScaled(t.lower);
  const upper = toScaled(t.upper);
  if (lower === null || upper === null) return false;
  const okLower = t.lowerBound === "INCLUSIVE" ? pct >= lower : pct > lower;
  const okUpper = t.upperBound === "INCLUSIVE" ? pct <= upper : pct < upper;
  return okLower && okUpper;
}

/**
 * その CAS の含有率を、まとめかたに従って数える。
 *
 * ELEMENT のときは金属換算係数を掛ける。「鉛として」何％か、という数えかた。
 * 酸化鉛 0.06％ は、鉛としては 0.056％。**単純に足すと答えが変わる。**
 * 係数が無い CAS は、換算できないので **そのままの値** で数える
 * （0 にすると見落とすため、多いほうへ倒す）。
 */
function pctOf(
  line: ExpandedLine,
  mode: Aggregation,
  element: string | null,
  factors: ElementFactors,
): bigint {
  const raw = toScaled(line.totalPct) ?? 0n;
  if (mode !== "ELEMENT" || !element || !line.casNormalized) return raw;

  const found = factors.get(line.casNormalized)?.find((f) => f.element === element);
  if (!found) return raw;
  const ratio = toScaled(found.ratioPct);
  if (ratio === null) return raw;
  // 係数は重量％なので 100 で割る
  return (raw * ratio) / (100n * 1000000n);
}

/**
 * 1つの区分について判定する。
 *
 * **区分にまとめかたが指定されていたら、法文物質名の指定は見ない。**
 * 区分でまとめるときは、その区分に紐づく CAS を重複なく集めて一度だけ足す。
 * 法文物質名ごとの合計を足し上げると、同じ CAS が2つの法文物質名に
 * 紐づいていたときに二重に数えてしまう。
 */
export function judge(input: JudgeInput): JudgeResult {
  const { lines, category, entries, factors } = input;
  const byCas = new Map(
    lines.filter((l) => l.casNormalized).map((l) => [l.casNormalized as string, l]),
  );

  const reasons = new Set<ReviewReason>();
  const hits: JudgeHit[] = [];

  // 中身が分からないぶんが残っていれば、言い切れない
  if ((toScaled(input.unknownPct) ?? 0n) > 0n) reasons.add("unknownComposition");
  if (input.truncated > 0) reasons.add("truncated");

  /** その CAS がいくら効いたかを、まとめかたに従って出す */
  const shareOf = (list: string[], mode: Aggregation, element: string | null) =>
    list.map((c) => ({
      cas: c,
      pct: fromScaled(pctOf(byCas.get(c) as ExpandedLine, mode, element, factors)),
    }));

  if (category.aggregation !== "NONE") {
    // 区分でまとめる。CAS を重複なく集めてから、一度だけ足す
    const cas = [...new Set(entries.flatMap((e) => e.cas))].filter((c) => byCas.has(c));
    let total = 0n;
    for (const c of cas) {
      total += pctOf(
        byCas.get(c) as ExpandedLine,
        category.aggregation,
        category.aggregationElement,
        factors,
      );
    }
    if (within(total, category.threshold)) {
      hits.push({
        statutorySubstanceId: null,
        total: fromScaled(total),
        contributions: shareOf(cas, category.aggregation, category.aggregationElement),
      });
      // まとめた中に、条件つき・閾値未設定のものが混ざっていれば要確認
      for (const e of entries) {
        if (!e.cas.some((c) => byCas.has(c))) continue;
        if (e.conditional) reasons.add("conditionalExclusion");
        if (e.unfilled) reasons.add("unfilledThreshold");
      }
    }
    return finish(hits, reasons);
  }

  for (const e of entries) {
    const present = e.cas.filter((c) => byCas.has(c));
    if (present.length === 0) continue;

    if (e.aggregation === "NONE") {
      /*
        まとめない。**CAS ごとに別々に閾値と比べる。**
        1つの法文物質名の中で、複数の CAS がそれぞれ閾値を超えることがあるので、
        当たったものは全部拾う（最初の1件で打ち切ると、残りが見えなくなる）。
      */
      const matched = present.filter((c) =>
        within(pctOf(byCas.get(c) as ExpandedLine, "NONE", null, factors), e.threshold),
      );
      if (matched.length > 0) {
        hits.push({
          statutorySubstanceId: e.id,
          // 足していないので合計は出さない
          total: null,
          contributions: shareOf(matched, "NONE", null),
        });
        continue;
      }
    } else {
      // まとめる。足した値ひとつを閾値と比べる
      let total = 0n;
      for (const c of present) {
        total += pctOf(byCas.get(c) as ExpandedLine, e.aggregation, e.aggregationElement, factors);
      }
      if (within(total, e.threshold)) {
        hits.push({
          statutorySubstanceId: e.id,
          total: fromScaled(total),
          contributions: shareOf(present, e.aggregation, e.aggregationElement),
        });
        continue;
      }
    }

    /*
      ここから下は「閾値では非該当と出たが、それを信じてよいか」の話。

      条件つきの除外（「〇・三％以下を含有し、**黒色に着色され、かつ…**を除く」）は、
      濃度が閾値を下回っていても、**条件を満たしていなければ法令上は該当する**。
      着色していない 0.2％ の製品は該当なのに、濃度だけを見ると非該当と出る。
      **これは見落とす向きの間違い**なので、該当に倒したうえで要確認にする。

      閾値を入れられなかったものも同じ。入っていることだけは分かっているので、
      該当として扱い、人に見てもらう。
    */
    if (e.conditional || e.unfilled) {
      if (e.conditional) reasons.add("conditionalExclusion");
      if (e.unfilled) reasons.add("unfilledThreshold");
      const aggregated = e.aggregation !== "NONE";
      const share = shareOf(present, e.aggregation, e.aggregationElement);
      hits.push({
        statutorySubstanceId: e.id,
        total: aggregated
          ? fromScaled(share.reduce((sum, x) => sum + (toScaled(x.pct) ?? 0n), 0n))
          : null,
        contributions: share,
      });
    }
  }

  return finish(hits, reasons);
}

/** 当たりが1つでもあれば該当。無ければ非該当 */
function finish(hits: JudgeHit[], reasons: Set<ReviewReason>): JudgeResult {
  return {
    verdict: hits.length > 0 ? "APPLICABLE" : "NOT_APPLICABLE",
    needsReview: reasons.size > 0,
    reasons: [...reasons],
    hits,
  };
}
