import { describe, expect, it } from "vitest";
import { getMessages } from "./i18n";
import { effectiveThreshold, statutorySubstanceSchema, type ThresholdValues } from "./law";

/**
 * 法文物質名の閾値は、空の欄が区分の値に従う（2026-09-16）。
 * 判定はこの埋めかたに乗っているので、欄ごとの独立した置き換えを表で固定しておく。
 */
const m = getMessages("ja");

const category: ThresholdValues = {
  thresholdLower: "1",
  lowerBound: "INCLUSIVE",
  thresholdUpper: "100",
  upperBound: "INCLUSIVE",
};

describe("effectiveThreshold", () => {
  it("全部空なら区分の値がそのまま使われ、4欄とも区分由来の印が付く", () => {
    const t = effectiveThreshold(
      { thresholdLower: null, lowerBound: null, thresholdUpper: null, upperBound: null },
      category,
    );
    expect(t).toMatchObject(category);
    expect(t.fromCategory).toEqual({
      thresholdLower: true,
      lowerBound: true,
      thresholdUpper: true,
      upperBound: true,
    });
  });

  it("入っている欄だけが自分の値になる（欄ごとに独立）", () => {
    const t = effectiveThreshold(
      { thresholdLower: "0.1", lowerBound: null, thresholdUpper: null, upperBound: "EXCLUSIVE" },
      category,
    );
    expect(t.thresholdLower).toBe("0.1");
    expect(t.lowerBound).toBe("INCLUSIVE");
    expect(t.thresholdUpper).toBe("100");
    expect(t.upperBound).toBe("EXCLUSIVE");
    expect(t.fromCategory).toEqual({
      thresholdLower: false,
      lowerBound: true,
      thresholdUpper: true,
      upperBound: false,
    });
  });

  it("区分と同じ値を自分で持っていても、区分由来の印は付かない", () => {
    const t = effectiveThreshold({ ...category }, category);
    expect(t.fromCategory.thresholdLower).toBe(false);
  });
});

describe("statutorySubstanceSchema の閾値", () => {
  const base = {
    code: "S1",
    classId: "cls",
    nameOriginal: "物質",
    nameLang: "JA",
    displayOrder: 1,
  };

  it("空文字・未指定は null（区分に従う）になる", () => {
    const r = statutorySubstanceSchema(m).safeParse({
      ...base,
      thresholdLower: "",
      lowerBound: "",
      thresholdUpper: "5",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.thresholdLower).toBeNull();
      expect(r.data.lowerBound).toBeNull();
      expect(r.data.thresholdUpper).toBe("5");
      expect(r.data.upperBound).toBeNull();
    }
  });

  it("入っている値の形はこれまでどおり検査する", () => {
    const r = statutorySubstanceSchema(m).safeParse({ ...base, thresholdLower: "abc" });
    expect(r.success).toBe(false);
  });

  it("両方入っているときだけ、下限が上限を超えていないかを見る", () => {
    const bad = statutorySubstanceSchema(m).safeParse({
      ...base,
      thresholdLower: "50",
      thresholdUpper: "10",
    });
    expect(bad.success).toBe(false);
    const half = statutorySubstanceSchema(m).safeParse({ ...base, thresholdLower: "50" });
    expect(half.success).toBe(true);
  });
});
