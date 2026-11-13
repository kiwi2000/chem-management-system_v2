import { describe, expect, it } from "vitest";
import {
  dependentMarks,
  hasAnyMark,
  impliedMarks,
  lacksSubstanceForComposition,
  linkMarks,
  NO_MARKS,
} from "./permission-group";

describe("管理グループの表の印の連動（S31 仕様 6-2）", () => {
  it("編集を付けると、同じ種類の参照も付く", () => {
    expect(linkMarks({ ...NO_MARKS, productEdit: true }).productView).toBe(true);
    expect(linkMarks({ ...NO_MARKS, substanceEdit: true }).substanceView).toBe(true);
  });

  it("組成 編集 → 組成 参照 → 製品・原材料 参照 とたどって付く", () => {
    const r = linkMarks({ ...NO_MARKS, compositionEdit: true });
    expect(r.compositionView).toBe(true);
    expect(r.productView).toBe(true);
    // 製品の編集までは付かない（組成は直せるが製品の名前は直せない形を許す）
    expect(r.productEdit).toBe(false);
  });

  it("組成 参照を付けても、物質 参照は付かない（11-06 決定）", () => {
    const r = linkMarks({ ...NO_MARKS, compositionView: true });
    expect(r.substanceView).toBe(false);
    expect(lacksSubstanceForComposition(r)).toBe(true);
    expect(lacksSubstanceForComposition({ ...r, substanceView: true })).toBe(false);
  });

  it("自動で付いた印だけを見分けられる", () => {
    expect([...impliedMarks({ ...NO_MARKS, compositionEdit: true })].sort()).toEqual([
      "compositionView",
      "productView",
    ]);
  });

  it("参照を外すと、それを前提にしている印も外れる", () => {
    expect(dependentMarks("productView")).toEqual([
      "productEdit",
      "compositionView",
      "compositionEdit",
    ]);
    expect(dependentMarks("substanceView")).toEqual(["substanceEdit"]);
  });

  it("印が 1 つも無い行は残さない", () => {
    expect(hasAnyMark(NO_MARKS)).toBe(false);
    expect(hasAnyMark({ ...NO_MARKS, substanceView: true })).toBe(true);
  });
});
