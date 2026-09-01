import { fromScaled, toScaled } from "@chem/shared";

/**
 * 法規制の判定。**ここはデータベースを知らない。**
 *
 * 展開済みの組成（製品 × CAS × 合計含有率）と、法律側の決めごとを受け取って、
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
  /**
   * CAS ごとの、その結び付きを持っているデータソースのID（優先度の順）。
   *
   * **判定はデータソースを選ばず、載っているものを全部見る。**
   * どこから来た結び付きで当たったのかは、あとから引き直すと
   * バージョンが切り替わったときに答えが変わってしまうので、
   * 判定した時点のものを結果に残す
   */
  sourcesOf?: Record<string, string[]>;
  aggregation: Aggregation;
  /** 元素換算でまとめるときの元素記号 */
  metalEtc: string | null;
  threshold: Threshold;
  /** 濃度のほかに条件が付く（備考に印がある）。当たったら要確認にする */
  conditional: boolean;
  /**
   * **条件つきで結ばれた CAS。**
   *
   * 外部データベースが総称から個々の異性体へ広げ、
   * 「法律の名称が定める条件に合致すること」と但し書きを付けたもの。
   * 当たったら必ず警告を出す。要確認にするかどうかはシステム設定で決まる
   */
  conditionalCas?: string[];
  /** 閾値を入れられなかった（備考に印がある）。当たったら要確認にする */
  unfilled: boolean;
}

export interface JudgeCategory {
  aggregation: Aggregation;
  metalEtc: string | null;
  threshold: Threshold;
  /**
   * 閾値が何に対する濃度か。省くと製品全体。
   * 均質材料あたりなら、当たっても当たらなくても必ず要確認にする
   */
  thresholdBasis?: "PRODUCT" | "HOMOGENEOUS_MATERIAL";
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
  /**
   * 条件つきのCASリンクの扱い（システム設定 `judgment.conditional_link_mode`）。
   *
   *   hit    … 条件が無いものとして該非を確定し、警告を出す
   *   review … 要確認にして警告を出す
   *
   * **どちらでも警告は出る。**省くと `review`
   */
  conditionalLinkMode?: "hit" | "review";
}

/** 要確認にした理由。文言は画面側で付ける */
export type ReviewReason =
  /** 金属等が決まっているのに、その CAS の換算係数が無い */
  | "missingFactor"
  /** 中身の分からない原材料が残っている */
  | "unknownComposition"
  /** 深すぎて展開しきれなかった */
  | "truncated"
  /** 当たった法文物質名に、濃度以外の条件が付いている */
  | "conditionalExclusion"
  /** 閾値を入れられていない法文物質名に、当たる物質が入っている */
  | "unfilledThreshold"
  /** 当たった CAS が、法律の名称の条件に合うか外部データベースが確かめよと言っている */
  | "conditionalLink"
  /**
   * 閾値が**均質材料あたり**で決まっている（RoHS など）。
   * こちらの組成は製品全体でしか持っていないので、当たっても当たらなくても言い切れない
   */
  | "homogeneousMaterial";

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
  contributions: { cas: string; pct: string; sources: string[] }[];
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
 * ELEMENT のときは換算係数を掛ける。「鉛として」何％か、という数えかた。
 * 酸化鉛 0.06％ は、鉛としては 0.056％。**単純に足すと答えが変わる。**
 *
 * **係数が無い CAS は 0 として数える。**
 * そのままの値を使うと「換算したつもりで換算していない」状態になり、
 * 画面上それが見分けられない。0 にすると足りないほうへ倒れるので、
 * 呼び出し側で**必ず要確認の印を立てる**（missing を返すのはそのため）。
 *
 * 金属等は金属とは限らない（化管法の「無機シアン化合物」はシアン CN として換算する）。
 */
function pctOf(
  line: ExpandedLine,
  mode: Aggregation,
  target: string | null,
  factors: ElementFactors,
): { pct: bigint; missing: boolean } {
  const raw = toScaled(line.totalPct) ?? 0n;
  if (mode !== "ELEMENT" || !target || !line.casNormalized) return { pct: raw, missing: false };

  const found = factors.get(line.casNormalized)?.find((f) => f.element === target);
  const ratio = found ? toScaled(found.ratioPct) : null;
  if (ratio === null) return { pct: 0n, missing: true };
  // 係数は重量％なので 100 で割る
  return { pct: (raw * ratio) / (100n * 1000000n), missing: false };
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
  const linkMode = input.conditionalLinkMode ?? "review";
  /** 当たった CAS が条件つきなら印を立てる */
  const markConditionalLink = (e: JudgeEntry, cas: string[]) => {
    if (cas.some((c) => e.conditionalCas?.includes(c))) reasons.add("conditionalLink");
  };
  /*
    **適用条件が書いてあれば、当たったときも必ず要確認にする。**
    濃度で当たっても、条件（用途・形状・候補の一覧に載っているだけ、など）を
    満たしているかは人にしか分からない。
    下回ったときだけ見ていると、**当たったときの「?」が出ない**
  */
  const markCondition = (e: JudgeEntry) => {
    if (e.conditional) reasons.add("conditionalExclusion");
  };
  const byCas = new Map(
    lines.filter((l) => l.casNormalized).map((l) => [l.casNormalized as string, l]),
  );

  const reasons = new Set<ReviewReason>();
  const hits: JudgeHit[] = [];

  /*
    閾値が**均質材料あたり**で決まっている区分（RoHS など）。
    こちらの組成は製品全体でしか持っていないので、割れば必ず薄まる。
    **当たっても当たらなくても言い切れない**ので、先に理由を立てておく。
    均質材料そのものを原材料として登録し、そちらを判定すれば正しく見られる
  */
  if (category.thresholdBasis === "HOMOGENEOUS_MATERIAL") reasons.add("homogeneousMaterial");

  // 中身が分からないぶんが残っていれば、言い切れない
  if ((toScaled(input.unknownPct) ?? 0n) > 0n) reasons.add("unknownComposition");
  if (input.truncated > 0) reasons.add("truncated");

  /**
   * その CAS がいくら効いたかを、まとめかたに従って出す。
   * 換算係数が無いものがあれば、要確認の印を立てる（0 として数えるため）。
   */
  /** その CAS を結んでいるデータソース。区分でまとめたときは、関わった全部を合わせる */
  const sourcesOf = (c: string) => [...new Set(entries.flatMap((e) => e.sourcesOf?.[c] ?? []))];

  const shareOf = (list: string[], mode: Aggregation, target: string | null) =>
    list.map((c) => {
      const r = pctOf(byCas.get(c) as ExpandedLine, mode, target, factors);
      if (r.missing) reasons.add("missingFactor");
      return { cas: c, pct: fromScaled(r.pct), sources: sourcesOf(c) };
    });

  /** 閾値と比べる値。合計するときはここを足す */
  const valueOf = (c: string, mode: Aggregation, target: string | null) => {
    const r = pctOf(byCas.get(c) as ExpandedLine, mode, target, factors);
    if (r.missing) reasons.add("missingFactor");
    return r.pct;
  };

  if (category.aggregation !== "NONE") {
    // 区分でまとめる。CAS を重複なく集めてから、一度だけ足す
    const cas = [...new Set(entries.flatMap((e) => e.cas))].filter((c) => byCas.has(c));
    let total = 0n;
    for (const c of cas) {
      total += valueOf(c, category.aggregation, category.metalEtc);
    }
    if (within(total, category.threshold)) {
      hits.push({
        statutorySubstanceId: null,
        total: fromScaled(total),
        contributions: shareOf(cas, category.aggregation, category.metalEtc),
      });
      // まとめた中に、条件つき・閾値未設定のものが混ざっていれば要確認
      for (const e of entries) {
        const present = e.cas.filter((c) => byCas.has(c));
        if (present.length === 0) continue;
        if (e.conditional) reasons.add("conditionalExclusion");
        if (e.unfilled) reasons.add("unfilledThreshold");
        markConditionalLink(e, present);
      }
    }
    return finish(hits, reasons, linkMode);
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
      const matched = present.filter((c) => within(valueOf(c, "NONE", null), e.threshold));
      if (matched.length > 0) {
        hits.push({
          statutorySubstanceId: e.id,
          // 足していないので合計は出さない
          total: null,
          contributions: shareOf(matched, "NONE", null),
        });
        markConditionalLink(e, matched);
        markCondition(e);
        continue;
      }
    } else {
      // まとめる。足した値ひとつを閾値と比べる
      let total = 0n;
      for (const c of present) {
        total += valueOf(c, e.aggregation, e.metalEtc);
      }
      if (within(total, e.threshold)) {
        hits.push({
          statutorySubstanceId: e.id,
          total: fromScaled(total),
          contributions: shareOf(present, e.aggregation, e.metalEtc),
        });
        markConditionalLink(e, present);
        markCondition(e);
        continue;
      }
    }

    /*
      ここから下は「閾値では非該当と出たが、それを信じてよいか」の話。

      条件つきの除外（「〇・三％以下を含有し、**黒色に着色され、かつ…**を除く」）は、
      濃度が閾値を下回っていても、**条件を満たしていなければ法律上は該当する**。
      着色していない 0.2％ の製品は該当なのに、濃度だけを見ると非該当と出る。
      **これは見落とす向きの間違い**なので、該当に倒したうえで要確認にする。

      閾値を入れられなかったものも同じ。入っていることだけは分かっているので、
      該当として扱い、人に見てもらう。
    */
    if (e.conditional || e.unfilled) {
      if (e.conditional) reasons.add("conditionalExclusion");
      if (e.unfilled) reasons.add("unfilledThreshold");
      const aggregated = e.aggregation !== "NONE";
      const share = shareOf(present, e.aggregation, e.metalEtc);
      hits.push({
        statutorySubstanceId: e.id,
        total: aggregated
          ? fromScaled(share.reduce((sum, x) => sum + (toScaled(x.pct) ?? 0n), 0n))
          : null,
        contributions: share,
      });
      markConditionalLink(e, present);
    }
  }

  return finish(hits, reasons, linkMode);
}

/**
 * 当たりが1つでもあれば該当。無ければ非該当。
 *
 * **警告（`reasons`）と要確認（`needsReview`）は別。**
 * 条件つきのCASリンクは、システム設定が `hit` のとき警告だけ出して要確認にしない
 */
function finish(
  hits: JudgeHit[],
  reasons: Set<ReviewReason>,
  linkMode: "hit" | "review",
): JudgeResult {
  const warnOnly = linkMode === "hit" ? new Set<ReviewReason>(["conditionalLink"]) : new Set();
  return {
    verdict: hits.length > 0 ? "APPLICABLE" : "NOT_APPLICABLE",
    needsReview: [...reasons].some((r) => !warnOnly.has(r)),
    reasons: [...reasons],
    hits,
  };
}
