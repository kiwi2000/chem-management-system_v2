import { DOCUMENT_TABLE_DEFS, fieldsFor, ORG_ITEM_PREFIX } from "@chem/shared";
import { describe, expect, it } from "vitest";
import { sampleTables, sampleValues } from "./doc-sample";

describe("プレビューの見本の値", () => {
  it("その対象で選べる差込項目には、すべて値が入る", () => {
    for (const target of ["PRODUCT", "SUBSTANCE"] as const) {
      const values = sampleValues(target, [], "ja");
      for (const f of fieldsFor(target)) {
        expect(values.get(f.key), `${target} の ${f.key} が空`).toBeTruthy();
      }
    }
  });

  it("会社の自由項目にも値が入る（項目名は会社ごとに違うため、名前から作る）", () => {
    const values = sampleValues("PRODUCT", ["住所"], "ja");
    expect(values.get(`${ORG_ITEM_PREFIX}住所`)).toBe("見本の住所");
  });

  it("英語の様式では英語の見本になる", () => {
    const values = sampleValues("PRODUCT", ["Address"], "en");
    expect(values.get("org.name")).toBe("Sample Co., Ltd.");
    expect(values.get(`${ORG_ITEM_PREFIX}Address`)).toBe("Sample Address");
  });

  it("本物と紛れない値にする（見本だと分かる）", () => {
    const values = sampleValues("PRODUCT", [], "ja");
    expect(values.get("product.nameJa")).toContain("見本");
    expect(values.get("org.name")).toContain("見本");
  });

  it("すべての表に、すべての列ぶんの見本の行が入る", () => {
    const tables = sampleTables("ja");
    for (const def of DOCUMENT_TABLE_DEFS) {
      const t = tables.get(def.key);
      expect(t, `${def.key} が無い`).toBeTruthy();
      expect(t!.columns.map((c) => c.key)).toEqual(def.columns.map((c) => c.key));
      expect(t!.rows.length).toBeGreaterThan(1);
      for (const c of def.columns) {
        // 「要確認」「備考」は付く行と付かない行があってよい
        const filled = t!.rows.filter((r) => r[c.key] !== "").length;
        expect(filled, `${def.key}.${c.key} がどの行も空`).toBeGreaterThan(0);
      }
    }
  });

  it("数の列には数が入る（幅の目安になるように）", () => {
    const rows = sampleTables("ja").get("composition")!.rows;
    for (const r of rows) expect(r.contentPct).toMatch(/^\d+\.\d$/);
  });
});
