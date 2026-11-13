import { describe, expect, it } from "vitest";
import {
  DATA_PERMISSIONS,
  GROUP_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_GROUPS,
  dependentsOf,
  expandPermissions,
} from "./permissions";

describe("権限の含意", () => {
  it("製品を編集できるなら製品を見られる。組成は別の印なので含まない（S31）", () => {
    expect(expandPermissions(["PRODUCT_EDIT"])).toEqual(["PRODUCT_VIEW", "PRODUCT_EDIT"]);
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

  it("承認は何も含まない（未公開を見られるのは承認の中で扱う。S31）", () => {
    expect(expandPermissions(["APPROVE"])).toEqual(["APPROVE"]);
  });

  it("管理グループに付ける権限は、製品・組成・物質と管理者を除いた全部（S31 仕様 6-3）", () => {
    expect([...GROUP_PERMISSIONS, ...DATA_PERMISSIONS, "ADMIN"].sort()).toEqual(
      [...PERMISSIONS].sort(),
    );
    expect(GROUP_PERMISSIONS).not.toContain("ADMIN");
    expect(GROUP_PERMISSIONS).not.toContain("PRODUCT_VIEW");
  });

  it("テンプレートを編集できる・帳票を落とせる・他人のを見られるは、どれもドキュメントの画面に入れる", () => {
    expect(expandPermissions(["DOC_TEMPLATE_EDIT"])).toEqual([
      "DOC_TEMPLATE_EDIT",
      "DOCUMENT_CREATE",
    ]);
    expect(expandPermissions(["DOCUMENT_DOWNLOAD"])).toEqual([
      "DOCUMENT_CREATE",
      "DOCUMENT_DOWNLOAD",
    ]);
    expect(dependentsOf("DOCUMENT_CREATE")).toEqual([
      "DOC_TEMPLATE_EDIT",
      "DOCUMENT_DOWNLOAD",
      "DOCUMENT_VIEW_ALL",
    ]);
  });

  it("画面のグループ分けは、すべての権限をちょうど 1 回ずつ載せる", () => {
    const listed = PERMISSION_GROUPS.flatMap((g) => g.permissions);
    expect([...listed].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("管理権限は他の権限を含意しない（管理者でも業務データは別途付与する）", () => {
    expect(expandPermissions(["ADMIN"])).toEqual(["ADMIN"]);
  });

  it("依存の洗い出しは間接的なものも拾う", () => {
    // PRODUCT_VIEW を外すと PRODUCT_EDIT も外れる
    expect(dependentsOf("PRODUCT_VIEW")).toEqual(["PRODUCT_EDIT"]);
    // ドキュメントの画面に入れなくなると、その中の権限も外れる
    expect(dependentsOf("DOCUMENT_CREATE")).toContain("DOCUMENT_VIEW_ALL");
  });

  it("何も持たない状態は空のまま", () => {
    expect(expandPermissions([])).toEqual([]);
  });
});
