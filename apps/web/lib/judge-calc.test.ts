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
 * そのまま出荷すれば法令違反になるので、境目を1つずつ確かめる。
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

const line = (cas: string, pct: string) => ({
  casNormalized: cas,
  substanceId: null,
  totalPct: pct,
});

describe("閾値との比較", () => {
  it("閾値を超えていれば該当", () => {
    const r = judge(
      input({ lines: [line("7439-92-1", "0.2")], entries: [entry({ threshold: over("0.1") })] }),
    );
    expect(r.verdict).toBe("APPLICABLE");
    expect(r.needsReview).toBe(false);
    expect(r.hits[0]?.total).toBeNull();
    expect(r.hits[0]?.contributions).toEqual([{ cas: "7439-92-1", pct: "0.2" }]);
  });

  it("閾値を下回れば非該当", () => {
    const r = judge(
      input({ lines: [line("7439-92-1", "0.05")], entries: [entry({ threshold: over("0.1") })] }),
    );
    expect(r.verdict).toBe("NOT_APPLICABLE");
  });

  it("境目そのものは該当しない（「以下を除く」なので）", () => {
    // 0.1％ちょうどは「0.1％以下」なので除外される
    const r = judge(
      input({ lines: [line("7439-92-1", "0.1")], entries: [entry({ threshold: over("0.1") })] }),
    );
    expect(r.verdict).toBe("NOT_APPLICABLE");
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
    expect(r.verdict).toBe("APPLICABLE");
  });

  it("その物質が入っていなければ、何も起きない", () => {
    const r = judge(input({ lines: [line("7440-22-4", "50")] }));
    expect(r.verdict).toBe("NOT_APPLICABLE");
    expect(r.hits).toEqual([]);
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
    expect(r.verdict).toBe("NOT_APPLICABLE");
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
    expect(r.verdict).toBe("APPLICABLE");
    expect(r.hits[0]?.total).toBe("0.12");
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
    expect(r.verdict).toBe("APPLICABLE");
    expect(r.hits[0]?.total).toBe("0.115698");
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
    expect(r.verdict).toBe("NOT_APPLICABLE");
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
    expect(r.verdict).toBe("NOT_APPLICABLE");
    expect(r.needsReview).toBe(true);
    expect(r.reasons).toContain("missingFactor");
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
    expect(r.verdict).toBe("NOT_APPLICABLE");
  });

  it("区分でまとめて閾値を超えれば、区分そのものが当たる", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.07"), line("7440-22-4", "0.07")],
        category: { aggregation: "SUM", metalEtc: null, threshold: over("0.1") },
        entries: [entry({ id: "a", cas: ["7439-92-1"] }), entry({ id: "b", cas: ["7440-22-4"] })],
      }),
    );
    expect(r.verdict).toBe("APPLICABLE");
    // 区分が当たったので、どの法文物質名かは指さない
    expect(r.hits[0]?.statutorySubstanceId).toBeNull();
    expect(r.hits[0]?.total).toBe("0.14");
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
    expect(r.verdict).toBe("APPLICABLE");
    // 0.05 の銀は閾値に届かないので入らない
    expect(r.hits[0]?.contributions).toEqual([
      { cas: "7439-92-1", pct: "0.5" },
      { cas: "1317-36-8", pct: "0.4" },
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
    expect(r.hits[0]?.total).toBeNull();
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
    expect(r.hits[0]?.total).toBe("0.12");
    expect(r.hits[0]?.contributions).toEqual([
      { cas: "7439-92-1", pct: "0.06" },
      { cas: "1317-36-8", pct: "0.06" },
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
    expect(r.hits[0]?.contributions.map((c) => c.cas)).toEqual(["7439-92-1", "7440-22-4"]);
    expect(r.hits[0]?.total).toBe("0.14");
  });
});

describe("要確認になる場面", () => {
  it("中身の分からない原材料が残っていれば、要確認", () => {
    const r = judge(input({ lines: [line("7440-22-4", "70")], unknownPct: "30" }));
    expect(r.needsReview).toBe(true);
    expect(r.reasons).toContain("unknownComposition");
  });

  it("深すぎて展開しきれなければ、要確認", () => {
    const r = judge(input({ truncated: 1 }));
    expect(r.reasons).toContain("truncated");
  });

  it("条件つきの除外は、閾値を下回っていても該当に倒して要確認にする", () => {
    /*
      **ここがいちばん間違えやすい。**
      「〇・三％以下を含有し、黒色に着色され、かつ…を除く」は、
      着色していなければ 0.2％でも法令上は該当する。
      濃度だけを見て非該当と出すと、**見落とす向きの間違い**になる
    */
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.2")],
        entries: [entry({ threshold: over("0.3"), conditional: true })],
      }),
    );
    expect(r.verdict).toBe("APPLICABLE");
    expect(r.needsReview).toBe(true);
    expect(r.reasons).toContain("conditionalExclusion");
  });

  it("条件つきでも、閾値を超えていれば迷わない（除外の余地が無い）", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.5")],
        entries: [entry({ threshold: over("0.3"), conditional: true })],
      }),
    );
    expect(r.verdict).toBe("APPLICABLE");
    expect(r.needsReview).toBe(false);
  });

  it("条件つきでも、その物質が入っていなければ何も起きない", () => {
    const r = judge(
      input({
        lines: [line("7440-22-4", "50")],
        entries: [entry({ threshold: over("0.3"), conditional: true })],
      }),
    );
    expect(r.verdict).toBe("NOT_APPLICABLE");
    expect(r.needsReview).toBe(false);
  });

  it("閾値を入れられていないものは、入っていれば該当に倒して要確認", () => {
    const r = judge(
      input({
        lines: [line("7439-92-1", "0.01")],
        entries: [entry({ threshold: over("50"), unfilled: true })],
      }),
    );
    expect(r.verdict).toBe("APPLICABLE");
    expect(r.reasons).toContain("unfilledThreshold");
  });

  it("何も引っかからなければ、非該当で確定", () => {
    const r = judge(input({ lines: [line("7440-22-4", "50")] }));
    expect(r.verdict).toBe("NOT_APPLICABLE");
    expect(r.needsReview).toBe(false);
    expect(r.reasons).toEqual([]);
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
    expect(r.verdict).toBe("NOT_APPLICABLE");
    expect(r.needsReview).toBe(true);
    expect(r.reasons).toContain("homogeneousMaterial");
  });

  it("該当したときも、要確認にする", () => {
    const r = judge(
      input({ lines: [line("7439-92-1", "30")], category: homogeneous, entries: rohs }),
    );
    expect(r.verdict).toBe("APPLICABLE");
    expect(r.needsReview).toBe(true);
    expect(r.reasons).toContain("homogeneousMaterial");
  });

  it("製品全体あたりの区分では、この理由は付かない", () => {
    const r = judge(
      input({ lines: [line("7439-92-1", "0.05")], entries: [entry({ threshold: over("0.1") })] }),
    );
    expect(r.reasons).not.toContain("homogeneousMaterial");
    expect(r.needsReview).toBe(false);
  });
});

describe("条件つきで結ばれたCAS", () => {
  /*
    外部データベースが総称から広げて結び付けたCAS。
    法令の名称が「炭素数が10のものに限る」のように絞っていると、当てはまらないことがある。
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
    expect(r.verdict).toBe("APPLICABLE");
    expect(r.reasons).toContain("conditionalLink");
    expect(r.needsReview).toBe(true);
  });

  it("該非を確定する設定なら、該当・警告。要確認にはしない", () => {
    const r = withConditionalLink("hit");
    expect(r.verdict).toBe("APPLICABLE");
    expect(r.reasons).toContain("conditionalLink");
    expect(r.needsReview).toBe(false);
  });

  it("設定を省くと、要確認にする側", () => {
    const r = judge(
      input({
        lines: [{ casNormalized: "7439-92-1", substanceId: "s1", totalPct: "5" }],
        entries: [entry({ conditionalCas: ["7439-92-1"] })],
      }),
    );
    expect(r.needsReview).toBe(true);
  });

  it("条件つきでないCASが当たっただけなら、警告は出ない", () => {
    const r = judge(
      input({
        lines: [{ casNormalized: "7439-92-1", substanceId: "s1", totalPct: "5" }],
        entries: [entry({ conditionalCas: ["7440-02-0"] })],
        conditionalLinkMode: "review",
      }),
    );
    expect(r.verdict).toBe("APPLICABLE");
    expect(r.reasons).not.toContain("conditionalLink");
    expect(r.needsReview).toBe(false);
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
    expect(r.reasons).toContain("conditionalLink");
    expect(r.reasons).toContain("unknownComposition");
    expect(r.needsReview).toBe(true);
  });
});
