import { describe, expect, it } from "vitest";
import { flattenOrgTree, isOrgTreeOrder } from "./org-tree";

const org = (id: string, parentId: string | null, displayOrder: number) => ({
  id,
  parentId,
  displayOrder,
  nameJa: id,
});

describe("flattenOrgTree", () => {
  it("上の組織のすぐ下に、その下の組織を表示順で並べ、深さを付ける", () => {
    const out = flattenOrgTree([
      org("PT", null, 10),
      org("MFG", "HQ", 2),
      org("HQ", null, 0),
      org("QA", "HQ", 1),
      org("QA1", "QA", 0),
    ]);
    expect(out.map((x) => `${x.org.id}:${x.depth}`)).toEqual([
      "HQ:0",
      "QA:1",
      "QA1:2",
      "MFG:1",
      "PT:0",
    ]);
  });
});

describe("isOrgTreeOrder", () => {
  const asc = [{ column: "displayOrder", direction: "asc" }];
  it("表示順の昇順だけで、絞り込みが無いときは木の順", () => {
    expect(isOrgTreeOrder({ sort: asc, filters: {} })).toBe(true);
  });
  it("ほかの並べ替え・降順・絞り込みではふつうの一覧", () => {
    expect(isOrgTreeOrder({ sort: [{ column: "code", direction: "asc" }], filters: {} })).toBe(
      false,
    );
    expect(
      isOrgTreeOrder({ sort: [{ column: "displayOrder", direction: "desc" }], filters: {} }),
    ).toBe(false);
    expect(
      isOrgTreeOrder({ sort: asc, filters: { kind: { kind: "enum", values: ["COMPANY"] } } }),
    ).toBe(false);
  });
});
