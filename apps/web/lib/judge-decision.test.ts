import { describe, expect, it } from "vitest";
import { applyDecision, premiseOf, samePremise, type Decision } from "./judge-decision";

/**
 * 人の判断を、判定し直した結果に引き継ぐかどうか。
 *
 * 引き継ぎすぎると、前提が変わったのに古い判断（非該当）が乗ったまま出荷される。
 * 引き継がなさすぎると、版が変わるたびに全製品を見直すことになり、印が無視される。
 * 「前提が同じときだけ」を、ここで固定しておく。
 */

const hit = (id: string | null, cas: string[]) => ({
  statutorySubstanceId: id,
  total: null,
  contributions: cas.map((c) => ({ cas: c, pct: "1", sources: [] })),
});

const decision = (x: Partial<Decision> = {}): Decision => ({
  verdict: "NOT_APPLICABLE",
  systemVerdict: "APPLICABLE",
  premise: "s1:7439-92-1",
  decidedBy: "u1",
  decidedAt: new Date("2026-09-12T08:00:00Z"),
  decidedNote: "金属鉛ではない",
  ...x,
});

describe("premiseOf", () => {
  it("法文物質名とCASを並べ替えてつなぐ。並びが違っても同じ", () => {
    const a = premiseOf([hit("s2", ["b", "a"]), hit("s1", ["x"])]);
    const b = premiseOf([hit("s1", ["x"]), hit("s2", ["a", "b"])]);
    expect(a).toBe("s1:x;s2:a,b");
    expect(b).toBe(a);
  });

  it("区分そのものでまとめて当たったときは * で表す。当たりが無ければ空", () => {
    expect(premiseOf([hit(null, ["7439-92-1"])])).toBe("*:7439-92-1");
    expect(premiseOf([])).toBe("");
  });

  it("同じCASが重なっても1つに数える", () => {
    expect(premiseOf([hit("s1", ["a", "a"])])).toBe("s1:a");
  });
});

describe("samePremise", () => {
  it("判定も当たりかたも同じなら同じ前提", () => {
    expect(samePremise({ verdict: "APPLICABLE", premise: "s1:7439-92-1" }, decision())).toBe(true);
  });

  it("当たる法文物質名やCASが変われば別の前提", () => {
    expect(
      samePremise({ verdict: "APPLICABLE", premise: "s1:7439-92-1,1317-36-8" }, decision()),
    ).toBe(false);
  });

  it("システムの判定が変われば別の前提（当たらなくなった）", () => {
    expect(samePremise({ verdict: "NOT_APPLICABLE", premise: "" }, decision())).toBe(false);
  });
});

describe("applyDecision", () => {
  const system = {
    verdict: "APPLICABLE" as const,
    needsReview: false,
    reasons: [] as ("conditionalLink" | "decisionDropped")[],
  };

  it("判断が無ければシステムの結果のまま", () => {
    const r = applyDecision(system, "s1:7439-92-1", null);
    expect(r).toMatchObject({ verdict: "APPLICABLE", source: "SYSTEM", needsReview: false });
    expect(r.decidedBy).toBeNull();
  });

  it("前提が同じなら、人の判定を当てはめて「人が判断」にする", () => {
    const r = applyDecision(system, "s1:7439-92-1", decision());
    expect(r).toMatchObject({
      verdict: "NOT_APPLICABLE",
      source: "USER",
      needsReview: false,
      decidedBy: "u1",
      decidedNote: "金属鉛ではない",
    });
  });

  it("確認しただけ（判定は変えていない）なら、判定はシステムのまま印だけ引き継ぐ", () => {
    const r = applyDecision(
      { ...system, needsReview: true, reasons: ["conditionalLink"] },
      "s1:7439-92-1",
      decision({ verdict: null }),
    );
    expect(r).toMatchObject({ verdict: "APPLICABLE", source: "SYSTEM", needsReview: false });
    // 警告は残す。確認は済んだが、気を付ける相手であることは変わらない
    expect(r.reasons).toEqual(["conditionalLink"]);
    expect(r.decidedBy).toBe("u1");
  });

  it("人がシステムと同じ値を選び直していれば「人が判断」にはしない", () => {
    const r = applyDecision(system, "s1:7439-92-1", decision({ verdict: "APPLICABLE" }));
    expect(r.source).toBe("SYSTEM");
    expect(r.needsReview).toBe(false);
  });

  it("前提が変わっていれば当てはめず、要確認にして理由を残す", () => {
    const r = applyDecision(system, "s1:7439-92-1,1317-36-8", decision());
    expect(r).toMatchObject({ verdict: "APPLICABLE", source: "SYSTEM", needsReview: true });
    expect(r.reasons).toEqual(["decisionDropped"]);
    expect(r.decidedBy).toBeNull();
  });

  it("当たらなくなったときも、判断を外したことは伝える（黙って非該当にしない）", () => {
    const r = applyDecision(
      { verdict: "NOT_APPLICABLE", needsReview: false, reasons: [] },
      "",
      decision(),
    );
    expect(r.verdict).toBe("NOT_APPLICABLE");
    expect(r.needsReview).toBe(true);
    expect(r.reasons).toContain("decisionDropped");
  });
});
