import { describe, expect, it } from "vitest";
import { PERMISSIONS, dependentsOf, expandPermissions } from "./permissions";

describe("権限の含意", () => {
  it("製品を編集できるなら、製品と組成が見られる", () => {
    expect(expandPermissions(["PRODUCT_EDIT"])).toEqual([
      "PRODUCT_VIEW",
      "PRODUCT_EDIT",
      "COMPOSITION_VIEW",
    ]);
  });

  it("無効・未公開を編集できるなら、見ることもできる", () => {
    expect(expandPermissions(["INACTIVE_EDIT"])).toEqual(["INACTIVE_VIEW", "INACTIVE_EDIT"]);
  });

  it("他人のお知らせを編集できるなら、投稿もできる", () => {
    expect(expandPermissions(["NEWS_MANAGE"])).toEqual(["NEWS_POST", "NEWS_MANAGE"]);
  });

  it("結果は定義順に並び、指定した順序に依存しない", () => {
    const a = expandPermissions(["SUBSTANCE_EDIT", "PRODUCT_EDIT"]);
    const b = expandPermissions(["PRODUCT_EDIT", "SUBSTANCE_EDIT"]);
    expect(a).toEqual(b);
    expect(a).toEqual(PERMISSIONS.filter((p) => a.includes(p)));
  });

  it("管理権限は他の権限を含意しない（管理者でも業務データは別途付与する）", () => {
    expect(expandPermissions(["ADMIN"])).toEqual(["ADMIN"]);
  });

  it("依存の洗い出しは間接的なものも拾う", () => {
    // COMPOSITION_VIEW を外すと、それを前提にしている PRODUCT_EDIT も外れる
    expect(dependentsOf("COMPOSITION_VIEW")).toContain("PRODUCT_EDIT");
    // PRODUCT_VIEW を外すと PRODUCT_EDIT も外れる
    expect(dependentsOf("PRODUCT_VIEW")).toEqual(["PRODUCT_EDIT"]);
    // 無効・未公開の閲覧を外すと、その編集も外れる
    expect(dependentsOf("INACTIVE_VIEW")).toEqual(["INACTIVE_EDIT"]);
  });

  it("何も持たない状態は空のまま", () => {
    expect(expandPermissions([])).toEqual([]);
  });
});
