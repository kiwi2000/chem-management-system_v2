import { describe, expect, it } from "vitest";
import { inventoryFoot, regulationFoot } from "./aggregate-footer";

const reg = (categoryId: string, needsReview = false) => ({ categoryId, needsReview });
const cats = new Set(["c1"]);

describe("regulationFoot", () => {
  it("要確認の付かない当たりだけなら該当", () => {
    expect(regulationFoot([{ regulations: [reg("c1")] }, { regulations: [] }], cats, true)).toBe(
      "applicable",
    );
  });
  it("要確認の付いた当たりだけなら要確認", () => {
    expect(regulationFoot([{ regulations: [reg("c1", true)] }], cats, true)).toBe("review");
  });
  it("両方あれば該当（「?」付きを調べても製品の結論は変わらない。別の行でも）", () => {
    expect(
      regulationFoot(
        [{ regulations: [reg("c1")] }, { regulations: [reg("c1", true)] }],
        cats,
        true,
      ),
    ).toBe("applicable");
  });
  it("ほかの区分の当たりは数えない", () => {
    expect(regulationFoot([{ regulations: [reg("c2"), reg("c2", true)] }], cats, true)).toBe(
      "notApplicable",
    );
  });
  it("当たりが無く判定済みなら非該当、判定したことが無ければ未判定", () => {
    expect(regulationFoot([{ regulations: [] }], cats, true)).toBe("notApplicable");
    expect(regulationFoot([{ regulations: [] }], cats, false)).toBe("notJudged");
  });
});

describe("inventoryFoot", () => {
  const listed = { numbers: [{ inventoryId: "i1" }] };
  const notListed = { numbers: [{ inventoryId: "i2" }] };
  it("全部の行が載っていれば全て該当", () => {
    expect(inventoryFoot([listed, listed], "i1", false)).toBe("allListed");
  });
  it("1 行でも載っていなければ要確認（CAS 番号の無い行も同じ）", () => {
    expect(inventoryFoot([listed, notListed], "i1", false)).toBe("review");
    expect(inventoryFoot([listed, { numbers: [] }], "i1", false)).toBe("review");
  });
  it("中身の分からない分があれば、全部載っていても要確認", () => {
    expect(inventoryFoot([listed], "i1", true)).toBe("review");
  });
  it("行が無ければ要確認", () => {
    expect(inventoryFoot([], "i1", false)).toBe("review");
  });
});
