import { describe, expect, it } from "vitest";
import {
  judge,
  type ElementFactors,
  type JudgeEntry,
  type JudgeInput,
  type Threshold,
} from "./judge-calc";

/**
 * 法規制の判定。
 *
 * ここが狂うと、**該当するものを「該当しない」と答える**。
 * そのまま出荷すれば法律違反になるので、境目を1つずつ確かめる。
 */

/** 「〇・一％以下を除く」＝ 0.1 を超えて 100 まで、という入りかた */
const over = (lower: string): Threshold => ({
  lower,
  lowerBound: "EXCLUSIVE",
  upper: "100",
  upperBound: "INCLUSIVE",
});

/** どんな濃度でも該当（閾値を入れていない状態の既定） */
const any: Threshold = over("0");

const entry = (x: Partial<JudgeEntry> = {}): JudgeEntry => ({
  id: "e1",
  cas: ["7439-92-1"],
  aggregation: "NONE",
  metalEtc: null,
  threshold: any,
  conditional: false,
  unfilled: false,
  ...x,
});

const input = (x: Partial<JudgeInput> = {}): JudgeInput => ({
  lines: [],
  unknownPct: "0",
  truncated: 0,
  category: { aggregation: "NONE", metalEtc: null, threshold: any },
  entries: [entry()],
  factors: new Map(),
  ...x,
});

const line = (cas: string, pct: string, impurityTypeId = "ip-none") => ({
  casNormalized: cas,
  substanceId: null,
  totalPct: pct,
  impurityTypeId,
});

/**
 * 結果の 1 単位目。**判定の単位は法文物質名（区分でまとめる区分だけ区分）**なので、
 * 法文物質名が 1 つの試験では units[0] がその法文物質名の結果。
 * 入っていない法文物質名は結果に並ばないので、その場合は「非該当・理由なし」と読む
 */
const first = (r: ReturnType<typeof judge>) =>
  r.units[0] ?? {
    statutorySubstanceId: null,
    verdict: "NOT_APPLICABLE" as const,
    needsReview: false,
    reasons: [] as string[],
    total: null,
    contributions: [] as { cas: string; pct: string; sources: string[]; type: string }[],
    excluded: [] as { cas: string; pct: string; type: string }[],
  };

describe("閾値との比較", () => {
  it("閾値を超えていれば該当", () => {
    const r = judge(
      input({ lines: [line("7439-92-1", "0.2")], entries: [entry({ threshold: over("0.1") })] }),
    );
    expect(first(r).verdict).toBe("APPLICABLE");
    expect(first(r).needsReview).toBe(false);
    expect(first(r).total).toBeNull();
    expect(first(r).contributions).toEqual([
      { cas: "7439-92-1", pct: "0.2", sources: [], type: "ip-none" },
    ]);
  });

  it("閾値を下回れば非該当", () => {
    const r = judge(
      input({ lines: [line("7439-92-1", "0.05")], entries: [entry({ threshold: over("0.1") })] }),
    );
    expect(first(r).verdict).toBe("NOT_APPLICABLE");
  });

  it("境目そのものは該当しない（「以下を除く」なので）", () => {
    // 0.1％ちょうどは「0.1％以下」なので除外される
    const r = judge(
      input({ lines: [line("7439-92-1", "0.1")], entries: [entry({ threshold: over("0.1") })] }),
    );
    expect(first(r).verdict).toBe("NOT_APPLICABLE");
  });

  it("境目を含む書きかたなら、境目でも該当する", () => {
    const t: Threshold = {
      lower: "0.1",
      lowerBound: "INCLUSIVE",
      upper: "100",
      upperBound: "INCLUSIVE",
    };
    const r = judge(
      input({ lines: [line("7439-92-1", "0.1")], entries: [entry({ threshold: t })] }),
    );
    expect(first(r).verdict).toBe("APPLICABLE");
  });

  it("その物質が入っていなければ、何も起きない", () => {
    const r = judge(input({ lines: [line("7440-22-4", "50")] }));
    // 入っていない法文物質名は結果に並ばない（区分の法文物質名の数だけ行ができないように）
    expect(r.units).toEqual([]);
    expect(r.unit).toBe("substance");
  });
});

describe("判定の単位は法文物質名", () => {
  it("入っているが閾値に届かない法文物質名は、非該当として入っている値を残す", () => {
    const r = judge(
      input({ lines: [line("7439-92-1", "0.05")], entries: [entry({ threshold: over("0.1") })] }),
    );
    expect(r.units).toHaveLength(1);
    expect(first(r).verdict).toBe("NOT_APPLICABLE");
    // 「含有率不足」を読めるように、閾値に届かなかった値をそのまま残す
    expect(first(r).contributions).toEqual([
      { cas: "7439-92-1", pct: "0.05", sources: [], type: "ip-none" },
    ]);
    expect(first(r).total).toBeNull();
  });

  it("同じ区分でも、法文物質名ごとに別々の結果になる", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.5"), line("7440-22-4", "0.01")],
        entries: [
          entry({ id: "a", cas: ["7439-92-1"], threshold: over("0.1") }),
          entry({ id: "b", cas: ["7440-22-4"], threshold: over("0.1") }),
          entry({ id: "c", cas: ["50-00-0"], threshold: over("0.1") }),
        ],
      }),
    );
    expect(r.unit).toBe("substance");
    // c は入っていないので並ばない
    expect(r.units.map((u) => [u.statutorySubstanceId, u.verdict])).toEqual([
      ["a", "APPLICABLE"],
      ["b", "NOT_APPLICABLE"],
    ]);
  });

  it("区分全体にかかる理由（中身が分からない）は、その区分のどの単位にも付く", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.5"), line("7440-22-4", "0.01")],
        unknownPct: "30",
        entries: [
          entry({ id: "a", cas: ["7439-92-1"], threshold: over("0.1") }),
          entry({ id: "b", cas: ["7440-22-4"], threshold: over("0.1") }),
        ],
      }),
    );
    expect(r.units.every((u) => u.reasons.includes("unknownComposition"))).toBe(true);
    expect(r.units.every((u) => u.needsReview)).toBe(true);
  });

  it("換算係数が無い理由は、その法文物質名にだけ付く", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.5"), line("1317-36-8", "0.5")],
        entries: [
          entry({ id: "a", cas: ["7439-92-1"], aggregation: "ELEMENT", metalEtc: "Pb" }),
          entry({ id: "b", cas: ["1317-36-8"], threshold: over("0.1") }),
        ],
        factors: new Map(),
      }),
    );
    const a = r.units.find((u) => u.statutorySubstanceId === "a")!;
    const b = r.units.find((u) => u.statutorySubstanceId === "b")!;
    expect(a.reasons).toContain("missingFactor");
    expect(b.reasons).not.toContain("missingFactor");
  });
});

describe("法文物質名でのまとめ", () => {
  const two = ["7439-92-1", "1317-36-8"]; // 鉛 と 酸化鉛

  it("まとめないと、それぞれが閾値に届かず非該当になる", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.06"), line("1317-36-8", "0.06")],
        entries: [entry({ cas: two, aggregation: "NONE", threshold: over("0.1") })],
      }),
    );
    expect(first(r).verdict).toBe("NOT_APPLICABLE");
  });

  it("まとめれば合計で閾値を超え、該当になる", () => {
    /*
      「鉛及びその化合物」のような書きかたでは、配下を合計しないと該当を見落とす。
      0.06 + 0.06 = 0.12 で 0.1 を超える
    */
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.06"), line("1317-36-8", "0.06")],
        entries: [entry({ cas: two, aggregation: "SUM", threshold: over("0.1") })],
      }),
    );
    expect(first(r).verdict).toBe("APPLICABLE");
    expect(first(r).total).toBe("0.12");
  });

  it("元素換算でまとめると、単純合算とは答えが変わる", () => {
    /*
      酸化鉛(PbO)は鉛としては 92.83％。
      0.06％の酸化鉛は、鉛としては 0.0557％ にしかならない。
      単純に足せば 0.12％ で該当だが、「鉛として」なら 0.1157％。
      どちらも 0.1 を超えるが、値が違う。ここを取り違えると境目で答えが変わる
    */
    const factors: ElementFactors = new Map([
      ["1317-36-8", [{ element: "Pb", ratioPct: "92.83" }]],
      ["7439-92-1", [{ element: "Pb", ratioPct: "100" }]],
    ]);
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.06"), line("1317-36-8", "0.06")],
        entries: [
          entry({
            cas: two,
            aggregation: "ELEMENT",
            metalEtc: "Pb",
            threshold: over("0.1"),
          }),
        ],
        factors,
      }),
    );
    expect(first(r).verdict).toBe("APPLICABLE");
    expect(first(r).total).toBe("0.115698");
  });

  it("換算の結果、閾値を下回れば非該当になる", () => {
    const factors: ElementFactors = new Map([["1317-36-8", [{ element: "Pb", ratioPct: "50" }]]]);
    const r = judge(
      input({
        lines: [line("1317-36-8", "0.15")],
        entries: [
          entry({
            cas: ["1317-36-8"],
            aggregation: "ELEMENT",
            metalEtc: "Pb",
            threshold: over("0.1"),
          }),
        ],
        factors,
      }),
    );
    // 0.15 の半分で 0.075。0.1 に届かない
    expect(first(r).verdict).toBe("NOT_APPLICABLE");
  });

  it("換算係数が無ければ 0 として数え、要確認にする", () => {
    /*
      そのままの値を使うと「換算したつもりで換算していない」状態になり、
      画面上それが見分けられない。0 にすると足りないほうへ倒れるので、
      **必ず要確認の印を立てる**（そのための印が missingFactor）。
    */
    const r = judge(
      input({
        lines: [line("1317-36-8", "0.15")],
        entries: [
          entry({
            cas: ["1317-36-8"],
            aggregation: "ELEMENT",
            metalEtc: "Pb",
            threshold: over("0.1"),
          }),
        ],
        factors: new Map(),
      }),
    );
    expect(first(r).verdict).toBe("NOT_APPLICABLE");
    expect(first(r).needsReview).toBe(true);
    expect(first(r).reasons).toContain("missingFactor");
  });
});

describe("区分でのまとめ", () => {
  it("区分でまとめると、法文物質名の設定は見ない", () => {
    /*
      同じCASが2つの法文物質名に紐づいている。
      法文物質名ごとの合計を足し上げると二重に数えるので、
      区分の側でCASを重複なく集めて一度だけ足す
    */
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.08")],
        category: { aggregation: "SUM", metalEtc: null, threshold: over("0.1") },
        entries: [
          entry({ id: "a", cas: ["7439-92-1"], aggregation: "SUM" }),
          entry({ id: "b", cas: ["7439-92-1"], aggregation: "SUM" }),
        ],
      }),
    );
    // 二重に数えれば 0.16 で該当になってしまう。正しくは 0.08 で非該当
    expect(first(r).verdict).toBe("NOT_APPLICABLE");
  });

  it("区分でまとめて閾値を超えれば、区分そのものが当たる", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.07"), line("7440-22-4", "0.07")],
        category: { aggregation: "SUM", metalEtc: null, threshold: over("0.1") },
        entries: [entry({ id: "a", cas: ["7439-92-1"] }), entry({ id: "b", cas: ["7440-22-4"] })],
      }),
    );
    expect(first(r).verdict).toBe("APPLICABLE");
    // 区分が単位。どの法文物質名かは指さず、結果も 1 件
    expect(r.unit).toBe("category");
    expect(r.units).toHaveLength(1);
    expect(first(r).statutorySubstanceId).toBeNull();
    expect(first(r).total).toBe("0.14");
  });
});

describe("まとめないときの、複数の当たり", () => {
  it("1つの法文物質名の中で、個別に閾値を超えたCASを全部拾う", () => {
    /*
      **最初の1件で打ち切ってはいけない。**
      「なぜ該当なのか」を出すとき、残りのCASが見えなくなる
    */
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.5"), line("1317-36-8", "0.4"), line("7440-22-4", "0.05")],
        entries: [
          entry({
            cas: ["7439-92-1", "1317-36-8", "7440-22-4"],
            aggregation: "NONE",
            threshold: over("0.1"),
          }),
        ],
      }),
    );
    expect(first(r).verdict).toBe("APPLICABLE");
    // 0.05 の銀は閾値に届かないので入らない
    expect(first(r).contributions).toEqual([
      { cas: "7439-92-1", pct: "0.5", sources: [], type: "ip-none" },
      { cas: "1317-36-8", pct: "0.4", sources: [], type: "ip-none" },
    ]);
  });

  /*
    **どのデータソースの結び付きで当たったのかを、判定した時点で残す。**
    あとから引き直すと、バージョンやリンクが変わったときに
    判定と食い違う答えを出してしまう
  */
  it("当たった根拠に、その結び付きを持っているデータソースを残す", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.2")],
        entries: [
          entry({
            threshold: over("0.1"),
            sourcesOf: { "7439-92-1": ["loli", "chrip"] },
          }),
        ],
      }),
    );
    expect(first(r).contributions).toEqual([
      { cas: "7439-92-1", pct: "0.2", sources: ["loli", "chrip"], type: "ip-none" },
    ]);
  });

  it("区分でまとめたときは、関わったデータソースを合わせて残す", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.06"), line("1317-36-8", "0.06")],
        category: { aggregation: "SUM", metalEtc: null, threshold: over("0.1") },
        entries: [
          entry({ id: "a", cas: ["7439-92-1"], sourcesOf: { "7439-92-1": ["loli"] } }),
          entry({ id: "b", cas: ["1317-36-8"], sourcesOf: { "1317-36-8": ["chrip"] } }),
        ],
      }),
    );
    expect(first(r).contributions).toEqual([
      { cas: "7439-92-1", pct: "0.06", sources: ["loli"], type: "ip-none" },
      { cas: "1317-36-8", pct: "0.06", sources: ["chrip"], type: "ip-none" },
    ]);
  });

  it("まとめないときは合計を出さない（足していないため）", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.5"), line("1317-36-8", "0.4")],
        entries: [entry({ cas: ["7439-92-1", "1317-36-8"], threshold: over("0.1") })],
      }),
    );
    // ここに 0.9 と出すと、足していないものを足したように読まれる
    expect(first(r).total).toBeNull();
  });

  it("まとめるときは、足したCASを全部並べて合計も出す", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.06"), line("1317-36-8", "0.06")],
        entries: [
          entry({ cas: ["7439-92-1", "1317-36-8"], aggregation: "SUM", threshold: over("0.1") }),
        ],
      }),
    );
    expect(first(r).total).toBe("0.12");
    expect(first(r).contributions).toEqual([
      { cas: "7439-92-1", pct: "0.06", sources: [], type: "ip-none" },
      { cas: "1317-36-8", pct: "0.06", sources: [], type: "ip-none" },
    ]);
  });

  it("区分でまとめるときも、足したCASを全部並べる", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.07"), line("7440-22-4", "0.07")],
        category: { aggregation: "SUM", metalEtc: null, threshold: over("0.1") },
        entries: [entry({ id: "a", cas: ["7439-92-1"] }), entry({ id: "b", cas: ["7440-22-4"] })],
      }),
    );
    expect(first(r).contributions.map((c) => c.cas)).toEqual(["7439-92-1", "7440-22-4"]);
    expect(first(r).total).toBe("0.14");
  });
});

describe("要確認になる場面", () => {
  it("中身の分からない原材料が残っていれば、要確認", () => {
    // 入っている法文物質名の行に付く（入っていないものは行そのものが無い）
    const r = judge(
      input({ lines: [line("7439-92-1", "1"), line("7440-22-4", "69")], unknownPct: "30" }),
    );
    expect(first(r).needsReview).toBe(true);
    expect(first(r).reasons).toContain("unknownComposition");
  });

  it("深すぎて展開しきれなければ、要確認", () => {
    const r = judge(input({ lines: [line("7439-92-1", "1")], truncated: 1 }));
    expect(first(r).reasons).toContain("truncated");
  });

  it("条件つきの除外は、閾値を下回っていても該当に倒して要確認にする", () => {
    /*
      **ここがいちばん間違えやすい。**
      「〇・三％以下を含有し、黒色に着色され、かつ…を除く」は、
      着色していなければ 0.2％でも法律上は該当する。
      濃度だけを見て非該当と出すと、**見落とす向きの間違い**になる
    */
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.2")],
        entries: [entry({ threshold: over("0.3"), conditional: true })],
      }),
    );
    expect(first(r).verdict).toBe("APPLICABLE");
    expect(first(r).needsReview).toBe(true);
    expect(first(r).reasons).toContain("conditionalExclusion");
  });

  it("適用条件が書いてあれば、閾値を超えて当たったときも要確認", () => {
    /*
      **条件は「除く」ものばかりではない。**
      「〜に用いる場合に限る」「候補の一覧に載っているだけ」のように、
      濃度で当たっても該当が確定しないものがある。
      条件を満たしているかは人にしか分からないので、当たったときも「?」を出す
    */
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.5")],
        entries: [entry({ threshold: over("0.3"), conditional: true })],
      }),
    );
    expect(first(r).verdict).toBe("APPLICABLE");
    expect(first(r).needsReview).toBe(true);
    expect(first(r).reasons).toContain("conditionalExclusion");
  });

  it("条件つきでも、その物質が入っていなければ何も起きない", () => {
    const r = judge(
      input({
        lines: [line("7440-22-4", "50")],
        entries: [entry({ threshold: over("0.3"), conditional: true })],
      }),
    );
    expect(first(r).verdict).toBe("NOT_APPLICABLE");
    expect(first(r).needsReview).toBe(false);
  });

  it("閾値を入れられていないものは、入っていれば該当に倒して要確認", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.01")],
        entries: [entry({ threshold: over("50"), unfilled: true })],
      }),
    );
    expect(first(r).verdict).toBe("APPLICABLE");
    expect(first(r).reasons).toContain("unfilledThreshold");
  });

  it("何も引っかからなければ、非該当で確定", () => {
    const r = judge(input({ lines: [line("7440-22-4", "50")] }));
    expect(first(r).verdict).toBe("NOT_APPLICABLE");
    expect(first(r).needsReview).toBe(false);
    expect(first(r).reasons).toEqual([]);
  });
});

describe("均質材料あたりの閾値（RoHS など）", () => {
  /*
    **こちらの組成は製品全体でしか持っていない。**
    ねじのめっきに鉛が30%入っていても、製品全体では0.05%まで薄まる。
    そのまま非該当と出すと、**見落とす向きの間違い**になる。
    当たっても当たらなくても言い切れないので、必ず要確認にする
  */
  const homogeneous = {
    aggregation: "NONE" as const,
    metalEtc: null,
    threshold: over("0.1"),
    thresholdBasis: "HOMOGENEOUS_MATERIAL" as const,
  };
  // まとめない区分では、閾値は法文物質名の側が持つ
  const rohs = [entry({ threshold: over("0.1") })];

  it("閾値を下回って非該当でも、要確認にする", () => {
    const r = judge(
      input({ lines: [line("7439-92-1", "0.05")], category: homogeneous, entries: rohs }),
    );
    expect(first(r).verdict).toBe("NOT_APPLICABLE");
    expect(first(r).needsReview).toBe(true);
    expect(first(r).reasons).toContain("homogeneousMaterial");
  });

  it("該当したときも、要確認にする", () => {
    const r = judge(
      input({ lines: [line("7439-92-1", "30")], category: homogeneous, entries: rohs }),
    );
    expect(first(r).verdict).toBe("APPLICABLE");
    expect(first(r).needsReview).toBe(true);
    expect(first(r).reasons).toContain("homogeneousMaterial");
  });

  it("製品全体あたりの区分では、この理由は付かない", () => {
    const r = judge(
      input({ lines: [line("7439-92-1", "0.05")], entries: [entry({ threshold: over("0.1") })] }),
    );
    expect(first(r).reasons).not.toContain("homogeneousMaterial");
    expect(first(r).needsReview).toBe(false);
  });
});

describe("条件つきで結ばれたCAS", () => {
  /*
    外部データベースが総称から広げて結び付けたCAS。
    法律の名称が「炭素数が10のものに限る」のように絞っていると、当てはまらないことがある。
    **どちらの設定でも警告は出す。**違いは要確認にするかどうか。
  */
  const withConditionalLink = (mode: "hit" | "review") =>
    judge(
      input({
        lines: [{ casNormalized: "7439-92-1", substanceId: "s1", totalPct: "5" }],
        entries: [entry({ conditionalCas: ["7439-92-1"] })],
        conditionalLinkMode: mode,
      }),
    );

  it("要確認にする設定なら、該当・警告・要確認", () => {
    const r = withConditionalLink("review");
    expect(first(r).verdict).toBe("APPLICABLE");
    expect(first(r).reasons).toContain("conditionalLink");
    expect(first(r).needsReview).toBe(true);
  });

  it("該非を確定する設定なら、該当・警告。要確認にはしない", () => {
    const r = withConditionalLink("hit");
    expect(first(r).verdict).toBe("APPLICABLE");
    expect(first(r).reasons).toContain("conditionalLink");
    expect(first(r).needsReview).toBe(false);
  });

  it("設定を省くと、要確認にする側", () => {
    const r = judge(
      input({
        lines: [{ casNormalized: "7439-92-1", substanceId: "s1", totalPct: "5" }],
        entries: [entry({ conditionalCas: ["7439-92-1"] })],
      }),
    );
    expect(first(r).needsReview).toBe(true);
  });

  it("条件つきでないCASが当たっただけなら、警告は出ない", () => {
    const r = judge(
      input({
        lines: [{ casNormalized: "7439-92-1", substanceId: "s1", totalPct: "5" }],
        entries: [entry({ conditionalCas: ["7440-02-0"] })],
        conditionalLinkMode: "review",
      }),
    );
    expect(first(r).verdict).toBe("APPLICABLE");
    expect(first(r).reasons).not.toContain("conditionalLink");
    expect(first(r).needsReview).toBe(false);
  });

  it("該非を確定する設定でも、ほかの要確認の理由は消さない", () => {
    const r = judge(
      input({
        lines: [{ casNormalized: "7439-92-1", substanceId: "s1", totalPct: "5" }],
        entries: [entry({ conditionalCas: ["7439-92-1"] })],
        unknownPct: "3",
        conditionalLinkMode: "hit",
      }),
    );
    expect(first(r).reasons).toContain("conditionalLink");
    expect(first(r).reasons).toContain("unknownComposition");
    expect(first(r).needsReview).toBe(true);
  });
});

/**
 * 不純物種別による除外（S21、2026-09-18 指示）。
 *
 * 不純物として入る物質は、規制によっては裾切値以上でも非該当。
 * **除外は閾値より先に決まる。**除外した寄与は捨てずに `excluded` に残し、
 * 「不純物のため非該当」として画面に出せるようにする
 */
describe("不純物種別による除外", () => {
  /** 指定した種別を、すべての単位で除外する */
  const exempt = (type: string) => (p: string) => p === type;

  it("不純物の種別が除外に当たれば、閾値を超えていても非該当", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "40", "ip-impurity")],
        entries: [entry({ threshold: over("0.1") })],
        isExempt: exempt("ip-impurity"),
      }),
    );
    expect(first(r).verdict).toBe("NOT_APPLICABLE");
    expect(first(r).contributions).toEqual([]);
    expect(first(r).excluded).toEqual([{ cas: "7439-92-1", pct: "40", type: "ip-impurity" }]);
  });

  it("除外の設定が無ければ、不純物でもいままでどおり判定する", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "40", "ip-impurity")],
        entries: [entry({ threshold: over("0.1") })],
      }),
    );
    expect(first(r).verdict).toBe("APPLICABLE");
    expect(first(r).excluded).toEqual([]);
  });

  it("同じCASが主成分と不純物で入っていても、種別をまたいで足さない", () => {
    // 0.6 + 0.6 = 1.2 だが、別々に見るのでどちらも 1% に届かない（2026-09-18 利用者の決定）
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.6"), line("7439-92-1", "0.6", "ip-impurity")],
        entries: [entry({ threshold: over("1") })],
      }),
    );
    expect(first(r).verdict).toBe("NOT_APPLICABLE");
    expect(first(r).contributions.map((c) => c.type)).toEqual(["ip-none", "ip-impurity"]);
  });

  it("主成分は判定し、不純物だけを除外する", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.2"), line("7439-92-1", "40", "ip-impurity")],
        entries: [entry({ threshold: over("0.1") })],
        isExempt: exempt("ip-impurity"),
      }),
    );
    expect(first(r).verdict).toBe("APPLICABLE");
    expect(first(r).contributions).toEqual([
      { cas: "7439-92-1", pct: "0.2", sources: [], type: "ip-none" },
    ]);
    expect(first(r).excluded).toEqual([{ cas: "7439-92-1", pct: "40", type: "ip-impurity" }]);
  });

  it("法文物質名ごとに除外を変えられる（区分の設定の上書き）", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "40", "ip-impurity")],
        entries: [
          entry({ id: "a", threshold: over("0.1") }),
          entry({ id: "b", threshold: over("0.1") }),
        ],
        // a では除外するが、b では除外しない
        isExempt: (p, sub) => p === "ip-impurity" && sub === "a",
      }),
    );
    expect(r.units.map((u) => [u.statutorySubstanceId, u.verdict])).toEqual([
      ["a", "NOT_APPLICABLE"],
      ["b", "APPLICABLE"],
    ]);
  });

  it("区分でまとめるときも、除外した寄与は合計に入れない", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.06"), line("1317-36-8", "0.06", "ip-impurity")],
        category: { aggregation: "SUM", metalEtc: null, threshold: over("0.1") },
        entries: [entry({ id: "a", cas: ["7439-92-1"] }), entry({ id: "b", cas: ["1317-36-8"] })],
        isExempt: exempt("ip-impurity"),
      }),
    );
    // 除外しなければ 0.12 で該当。除外すると 0.06 で非該当
    expect(first(r).verdict).toBe("NOT_APPLICABLE");
    expect(first(r).total).toBe("0.06");
    expect(first(r).excluded).toEqual([{ cas: "1317-36-8", pct: "0.06", type: "ip-impurity" }]);
  });

  it("除外は閾値より先。適用条件が付いていても、除外されれば非該当のまま", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "40", "ip-impurity")],
        // 条件つきは、ふだんは閾値を下回っても該当に倒して要確認にする
        entries: [entry({ threshold: over("99"), conditional: true })],
        isExempt: exempt("ip-impurity"),
      }),
    );
    expect(first(r).verdict).toBe("NOT_APPLICABLE");
    expect(first(r).reasons).not.toContain("conditionalExclusion");
  });
});

/**
 * 判定対象日に効いていない法文物質名・区分（施行前・適用終了）。
 * **該非は含有率で決めたまま持ち、印だけ付ける。**要確認と理由は付けない（2026-09-22 決定）
 */
describe("施行前・適用終了", () => {
  it("効いている法文物質名は印が IN_FORCE で、これまでどおり", () => {
    const r = judge(input({ lines: [line("7439-92-1", "1")] }));
    expect(first(r).verdict).toBe("APPLICABLE");
    expect(r.units[0]!.effective).toBe("IN_FORCE");
  });

  it("施行前の法文物質名は、当たっていても印 NOT_YET・要確認なし", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "1")],
        entries: [entry({ effective: "NOT_YET", conditional: true })],
      }),
    );
    const u = r.units[0]!;
    // 該非そのものは含有率で決めたまま（人の判断を施行日の前後で外さないため）
    expect(u.verdict).toBe("APPLICABLE");
    expect(u.effective).toBe("NOT_YET");
    expect(u.needsReview).toBe(false);
    expect(u.reasons).toEqual([]);
  });

  it("適用終了の法文物質名は印 EXPIRED", () => {
    const r = judge(
      input({ lines: [line("7439-92-1", "1")], entries: [entry({ effective: "EXPIRED" })] }),
    );
    expect(r.units[0]!.effective).toBe("EXPIRED");
  });

  it("区分が効いていなければ、中の法文物質名が効いていても効かない", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "1")],
        category: { aggregation: "NONE", metalEtc: null, threshold: any, effective: "EXPIRED" },
        entries: [entry({ effective: "IN_FORCE" })],
      }),
    );
    expect(r.units[0]!.effective).toBe("EXPIRED");
  });

  it("区分でまとめる区分が施行前なら、区分の単位に印 NOT_YET が付き要確認は付かない", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "1")],
        unknownPct: "5",
        category: { aggregation: "SUM", metalEtc: null, threshold: any, effective: "NOT_YET" },
      }),
    );
    expect(r.unit).toBe("category");
    expect(r.units[0]!.effective).toBe("NOT_YET");
    expect(r.units[0]!.needsReview).toBe(false);
  });
});
