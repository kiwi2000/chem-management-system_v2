import { describe, expect, it } from "vitest";
import { collapseToCategories } from "./judgement-collapse";
import type { ProductJudgementDto } from "./types";

/** 判定の行。試験に要るところだけ変えて使う */
function row(p: Partial<ProductJudgementDto>): ProductJudgementDto {
  return {
    id: "j",
    categoryId: "c1",
    statutorySubstanceId: "s1",
    statutoryName: "キシレン",
    officialNumber: "125",
    applicableCondition: "適用条件",
    asElement: null,
    effective: "IN_FORCE",
    effectiveScope: null,
    effectiveFrom: null,
    effectiveTo: null,
    verdict: "APPLICABLE",
    source: "SYSTEM",
    systemVerdict: "APPLICABLE",
    needsReview: false,
    reviewReasons: [],
    decidedByName: "山田",
    decidedAt: null,
    decidedNote: "根拠",
    droppedDecision: null,
    hits: [],
    hitsWithheld: true,
    ...p,
  } as ProductJudgementDto;
}

describe("collapseToCategories", () => {
  it("区分ごとに 1 行にまとめ、物質を推し量れる情報を消す", () => {
    const out = collapseToCategories([
      row({ statutorySubstanceId: "s1" }),
      row({ statutorySubstanceId: "s2", statutoryName: "トルエン", officialNumber: "46" }),
      row({ categoryId: "c2", verdict: "NOT_APPLICABLE" }),
    ]);
    expect(out).toHaveLength(2);
    for (const r of out) {
      expect(r.statutorySubstanceId).toBeNull();
      expect(r.statutoryName).toBeNull();
      expect(r.officialNumber).toBeNull();
      expect(r.applicableCondition).toBeNull();
      expect(r.decidedByName).toBeNull();
      expect(r.decidedNote).toBeNull();
      expect(r.hits).toEqual([]);
      expect(JSON.stringify(r)).not.toMatch(/キシレン|トルエン|125|46/);
    }
  });

  it("要確認の付いていない該当があれば該当（要確認付きが一緒にあっても）", () => {
    const [r] = collapseToCategories([row({}), row({ needsReview: true })]);
    expect(r!.verdict).toBe("APPLICABLE");
    expect(r!.needsReview).toBe(false);
  });

  it("要確認の付いた該当だけなら要確認", () => {
    const [r] = collapseToCategories([
      row({ needsReview: true }),
      row({ verdict: "NOT_APPLICABLE" }),
    ]);
    expect(r!.verdict).toBe("APPLICABLE");
    expect(r!.needsReview).toBe(true);
  });

  it("非該当の要確認・施行前の該当は非該当", () => {
    const [r] = collapseToCategories([
      row({ verdict: "NOT_APPLICABLE", needsReview: true }),
      row({ effective: "NOT_YET" }),
    ]);
    expect(r!.verdict).toBe("NOT_APPLICABLE");
    expect(r!.needsReview).toBe(false);
  });
});
