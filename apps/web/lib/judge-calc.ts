import { IMPURITY_NONE, fromScaled, toScaled } from "@chem/shared";

/**
 * 法規制の判定。**ここはデータベースを知らない。**
 *
 * 展開済みの組成（製品 × CAS × 合計含有率）と、法律側の決めごとを受け取って、
 * 該当か非該当かを出す。読み出しと保存は judge-store.ts の側。
 *
 * **判定の単位は「まとめる単位」と同じ**（2026-09-15 決定）。
 *
 *   区分でまとめる区分     … 区分そのものが 1 つの単位。結果は 1 件
 *   それ以外               … 法文物質名が単位。製品にその CAS が入っている法文物質名ごとに 1 件
 *                            （法文物質名でまとめるときも、まとめないときも同じ。まとめないときは
 *                            CAS ごとに閾値と比べるが、どれかが超えれば**その法文物質名**が該当）
 *
 * 単位ごとに 2 つに分けて返す。
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

/** 展開済みの組成の1行。同じ CAS でも不純物種別が違えば別の行 */
export interface ExpandedLine {
  casNormalized: string | null;
  substanceId: string | null;
  totalPct: string;
  /** 物質の不純物種別。省くと 0（不純物ではない） */
  impurityTypeId?: string;
}

/**
 * 不純物種別による除外の問い合わせ（S21）。
 * 「この種別の物質は、この判定の単位では非該当にするか」。
 * 法文物質名が単位なら id、区分そのものが単位なら null で聞く
 */
export type ExemptResolver = (typeId: string, statutorySubstanceId: string | null) => boolean;

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
   *   hit    … 「要確認」を付けない
   *   review … 「要確認」を付ける
   *
   * **どちらでも警告は出る。**省くと `review`
   */
  conditionalLinkMode?: "hit" | "review";
  /** 不純物種別による除外。省くと何も除外しない */
  isExempt?: ExemptResolver;
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
  | "homogeneousMaterial"
  /**
   * 人の判断（確認・上書き）があったが、前提が変わったので当てはめなかった。
   * 判定の計算では付かない。judge-decision.ts が判定し直したときに足す
   */
  | "decisionDropped";

/** 判定の 1 単位（区分そのもの、または法文物質名）の結果 */
export interface JudgeUnit {
  /** 法文物質名。区分でまとめたときは null（区分そのものが単位） */
  statutorySubstanceId: string | null;
  verdict: "APPLICABLE" | "NOT_APPLICABLE";
  needsReview: boolean;
  reasons: ReviewReason[];
  /**
   * 合算した含有率。**まとめたときだけ入る。**
   * まとめないときは CAS ごとに別々に比べているので、合計には意味が無い。
   * そこに数字を入れると、足していないものを足したように読まれてしまう
   */
  total: string | null;
  /**
   * この単位で見た CAS と、それぞれの含有率。
   *
   *   該当・まとめない … **個別に閾値を超えた CAS が、すべて並ぶ**
   *   該当・まとめる   … 足し合わせた CAS が、すべて並ぶ（元素換算なら換算後の値）
   *   非該当           … 製品に入っている CAS が並ぶ（閾値に届かなかった値。「含有率不足」を読むため）
   *
   * 同じ CAS が不純物種別違いで 2 行並ぶことがある（`type` で見分ける）
   */
  contributions: { cas: string; pct: string; sources: string[]; type: string }[];
  /**
   * **不純物種別の設定で除外した寄与**（S21）。閾値とは比べていない。
   * 「不純物のため非該当」として画面に出すために、消さずに残す。含有率はそのままの値
   */
  excluded: { cas: string; pct: string; type: string }[];
}

export interface JudgeResult {
  /** 判定の単位。"category" なら units は必ず 1 件 */
  unit: "category" | "substance";
  units: JudgeUnit[];
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
 * 区分でまとめるときは、その区分に紐づく CAS を重複なく集めて一度だけ足し、
 * 区分そのものを 1 つの単位として答える。法文物質名ごとの合計を足し上げると、
 * 同じ CAS が2つの法文物質名に紐づいていたときに二重に数えてしまう。
 *
 * それ以外は法文物質名が単位。**製品にその CAS が入っている法文物質名だけ**が結果に並ぶ
 * （閾値に届かなかったものも「非該当」として並ぶ。入っていないものは並ばない）。
 */
export function judge(input: JudgeInput): JudgeResult {
  const { lines, category, entries, factors } = input;
  const linkMode = input.conditionalLinkMode ?? "review";
  const isExempt = input.isExempt ?? (() => false);
  /** CAS → その CAS の行（不純物種別ごとに 1 行）。同じ CAS が複数並ぶことがある */
  const byCas = new Map<string, ExpandedLine[]>();
  for (const l of lines) {
    if (!l.casNormalized) continue;
    const list = byCas.get(l.casNormalized);
    if (list) list.push(l);
    else byCas.set(l.casNormalized, [l]);
  }
  const impurityTypeOf = (l: ExpandedLine) => l.impurityTypeId ?? IMPURITY_NONE;
  /**
   * その単位で見る行を、閾値と比べる行と、不純物種別で除外する行に分ける（S21）。
   * 除外は「法文物質名の上書き → 区分の設定 → 除外しない」の順に決めてある（isExempt が答える）
   */
  const splitLines = (cas: string[], statutorySubstanceId: string | null) => {
    const compared: ExpandedLine[] = [];
    const exempt: ExpandedLine[] = [];
    for (const c of cas) {
      for (const l of byCas.get(c) ?? []) {
        const p = impurityTypeOf(l);
        if (p !== IMPURITY_NONE && isExempt(p, statutorySubstanceId)) exempt.push(l);
        else compared.push(l);
      }
    }
    return { compared, exempt };
  };
  const excludedOf = (list: ExpandedLine[]) =>
    list.map((l) => ({
      cas: l.casNormalized as string,
      pct: fromScaled(toScaled(l.totalPct) ?? 0n),
      type: impurityTypeOf(l),
    }));

  /*
    区分全体にかかる理由。どの単位にも同じように付く。
    **均質材料あたり**の区分（RoHS など）は、製品全体の組成では割れば必ず薄まるので、
    当たっても当たらなくても言い切れない。均質材料そのものを原材料として登録し、
    そちらを判定すれば正しく見られる
  */
  const common: ReviewReason[] = [];
  if (category.thresholdBasis === "HOMOGENEOUS_MATERIAL") common.push("homogeneousMaterial");
  // 中身が分からないぶんが残っていれば、言い切れない
  if ((toScaled(input.unknownPct) ?? 0n) > 0n) common.push("unknownComposition");
  if (input.truncated > 0) common.push("truncated");

  /** その CAS を結んでいるデータソース。区分でまとめたときは、関わった全部を合わせる */
  const sourcesOf = (c: string) => [...new Set(entries.flatMap((e) => e.sourcesOf?.[c] ?? []))];

  /** 1 単位ぶんの計算。理由はこの単位のものだけを集める。行は CAS × 種別ごと */
  const unitOf = (statutorySubstanceId: string | null, excluded: JudgeUnit["excluded"]) => {
    const reasons = new Set<ReviewReason>(common);
    const shareOf = (list: ExpandedLine[], mode: Aggregation, target: string | null) =>
      list.map((l) => {
        const r = pctOf(l, mode, target, factors);
        if (r.missing) reasons.add("missingFactor");
        const cas = l.casNormalized as string;
        return { cas, pct: fromScaled(r.pct), sources: sourcesOf(cas), type: impurityTypeOf(l) };
      });
    /** 閾値と比べる値。合計するときはここを足す */
    const valueOf = (l: ExpandedLine, mode: Aggregation, target: string | null) => {
      const r = pctOf(l, mode, target, factors);
      if (r.missing) reasons.add("missingFactor");
      return r.pct;
    };
    const finish = (
      verdict: JudgeUnit["verdict"],
      total: string | null,
      contributions: JudgeUnit["contributions"],
    ): JudgeUnit => {
      // 条件つきのCASリンクは、システム設定が `hit` のとき警告だけ出して要確認にしない
      const warnOnly =
        linkMode === "hit" ? new Set<ReviewReason>(["conditionalLink"]) : new Set<ReviewReason>();
      return {
        statutorySubstanceId,
        verdict,
        needsReview: [...reasons].some((r) => !warnOnly.has(r)),
        reasons: [...reasons],
        total,
        contributions,
        excluded,
      };
    };
    return { reasons, shareOf, valueOf, finish };
  };
  const casOfLines = (list: ExpandedLine[]) => [
    ...new Set(list.map((l) => l.casNormalized as string)),
  ];

  if (category.aggregation !== "NONE") {
    // 区分でまとめる。CAS を重複なく集めてから、一度だけ足す（除外した行は足さない）
    const casAll = [...new Set(entries.flatMap((e) => e.cas))].filter((c) => byCas.has(c));
    const { compared, exempt } = splitLines(casAll, null);
    const u = unitOf(null, excludedOf(exempt));
    let total = 0n;
    for (const l of compared) total += u.valueOf(l, category.aggregation, category.metalEtc);
    const applicable = compared.length > 0 && within(total, category.threshold);
    if (applicable) {
      const comparedCas = new Set(casOfLines(compared));
      // まとめた中に、条件つき・閾値未設定のものが混ざっていれば要確認
      for (const e of entries) {
        const present = e.cas.filter((c) => comparedCas.has(c));
        if (present.length === 0) continue;
        if (e.conditional) u.reasons.add("conditionalExclusion");
        if (e.unfilled) u.reasons.add("unfilledThreshold");
        if (present.some((c) => e.conditionalCas?.includes(c))) u.reasons.add("conditionalLink");
      }
    }
    return {
      unit: "category",
      units: [
        u.finish(
          applicable ? "APPLICABLE" : "NOT_APPLICABLE",
          compared.length > 0 ? fromScaled(total) : null,
          u.shareOf(compared, category.aggregation, category.metalEtc),
        ),
      ],
    };
  }

  const units: JudgeUnit[] = [];
  for (const e of entries) {
    const presentAll = e.cas.filter((c) => byCas.has(c));
    // 入っていない法文物質名は結果に並べない（並べると区分の法文物質名の数だけ行ができる）
    if (presentAll.length === 0) continue;
    const { compared, exempt } = splitLines(presentAll, e.id);
    const u = unitOf(e.id, excludedOf(exempt));
    /*
      入っている行が全部、不純物種別で除外されたら**不純物のため非該当**。
      閾値とは比べず、条件つき・閾値未設定の理由も付けない（除外が先に決まる）
    */
    if (compared.length === 0) {
      units.push(u.finish("NOT_APPLICABLE", null, []));
      continue;
    }
    const present = casOfLines(compared);
    /** 当たった CAS が条件つきなら印を立てる */
    const markConditionalLink = (cas: string[]) => {
      if (cas.some((c) => e.conditionalCas?.includes(c))) u.reasons.add("conditionalLink");
    };
    /*
      **適用条件が書いてあれば、当たったときも必ず要確認にする。**
      濃度で当たっても、条件（用途・形状・候補の一覧に載っているだけ、など）を
      満たしているかは人にしか分からない。
      下回ったときだけ見ていると、**当たったときの「?」が出ない**
    */
    const markCondition = () => {
      if (e.conditional) u.reasons.add("conditionalExclusion");
    };

    if (e.aggregation === "NONE") {
      /*
        まとめない。**CAS ごとに別々に閾値と比べる。**
        1つの法文物質名の中で、複数の CAS がそれぞれ閾値を超えることがあるので、
        当たったものは全部拾う（最初の1件で打ち切ると、残りが見えなくなる）。
        どれかが超えれば、この法文物質名が該当
      */
      // 行は CAS × 種別ごと。**種別をまたいで足さない**（S21 決定）
      const matched = compared.filter((l) => within(u.valueOf(l, "NONE", null), e.threshold));
      if (matched.length > 0) {
        markConditionalLink(casOfLines(matched));
        markCondition();
        // 足していないので合計は出さない
        units.push(u.finish("APPLICABLE", null, u.shareOf(matched, "NONE", null)));
        continue;
      }
    } else {
      // まとめる。足した値ひとつを閾値と比べる（除外されなかった行は、種別に関わらず足す）
      let total = 0n;
      for (const l of compared) total += u.valueOf(l, e.aggregation, e.metalEtc);
      if (within(total, e.threshold)) {
        markConditionalLink(present);
        markCondition();
        units.push(
          u.finish("APPLICABLE", fromScaled(total), u.shareOf(compared, e.aggregation, e.metalEtc)),
        );
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
    const aggregated = e.aggregation !== "NONE";
    const share = u.shareOf(compared, e.aggregation, e.metalEtc);
    const total = aggregated
      ? fromScaled(share.reduce((sum, x) => sum + (toScaled(x.pct) ?? 0n), 0n))
      : null;
    if (e.conditional || e.unfilled) {
      if (e.conditional) u.reasons.add("conditionalExclusion");
      if (e.unfilled) u.reasons.add("unfilledThreshold");
      markConditionalLink(present);
      units.push(u.finish("APPLICABLE", total, share));
      continue;
    }
    // 入っているが閾値に届かない。**含有率不足による非該当**として、入っている値を残す
    units.push(u.finish("NOT_APPLICABLE", total, share));
  }

  return { unit: "substance", units };
}
