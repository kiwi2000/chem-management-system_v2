import { describe, expect, it } from "vitest";
import { mapHeader, REGULATION_LIST_COLUMNS } from "./columns";
import { detectImportFile, detectTableKind } from "./detect";
import { DATA_SET_FORMAT } from "./snapshot";

describe("mapHeader", () => {
  it("日本語と英語の列名を同じ鍵に当て、全角半角と空白の違いを吸収する", () => {
    const m = mapHeader(
      ["法律", " 規制区分 ", "law_code", "ＣＡＳ", "法文物質名", "謎の列"],
      REGULATION_LIST_COLUMNS,
    );
    expect(m.index).toMatchObject({ law: 0, category: 1, lawCode: 2, cas: 3, substance: 4 });
    expect(m.missing).toEqual([]);
    expect(m.unknown).toEqual(["謎の列"]);
  });

  it("必須が無ければ日本語の列名で知らせる", () => {
    const m = mapHeader(["法律", "規制区分"], REGULATION_LIST_COLUMNS);
    expect(m.missing).toEqual(["法文物質名", "CAS"]);
  });
});

describe("detectTableKind", () => {
  it("列名で種類を見分ける", () => {
    expect(detectTableKind(["法律", "規制区分", "法文物質名", "CAS"])).toEqual({
      ok: true,
      kind: "REGULATION_LIST",
    });
    expect(detectTableKind(["製品コード", "製品名", "CAS", "含有率"])).toEqual({
      ok: true,
      kind: "PRODUCTS",
    });
    expect(detectTableKind(["物質コード", "名称", "CAS"])).toEqual({
      ok: true,
      kind: "SUBSTANCES",
    });
  });

  it("どれでもなければ、いちばん近い種類の足りない列を返す", () => {
    const d = detectTableKind(["法律", "規制区分", "CAS"]);
    expect(d).toEqual({ ok: false, missing: ["法文物質名"], nearest: "REGULATION_LIST" });
  });
});

describe("detectImportFile", () => {
  it(".json は形式の印があればデータセット", () => {
    const good = JSON.stringify({ format: DATA_SET_FORMAT, laws: [], versions: [], sources: [] });
    expect(detectImportFile("set.json", good)).toEqual({ ok: true, kind: "DATA_SET" });
    expect(detectImportFile("set.json", JSON.stringify({ hello: 1 }))).toMatchObject({
      ok: false,
      reason: "not_data_set",
    });
    expect(detectImportFile("set.json", "{ broken")).toMatchObject({
      ok: false,
      reason: "unreadable",
    });
  });

  it(".tsv は 1 行目で種類を決め、行数を数える", () => {
    const d = detectImportFile(
      "list.tsv",
      "法律\t規制区分\t法文物質名\tCAS\nA\tB\tC\t50-00-0\nA\tB\tD\t71-43-2\n",
    );
    expect(d).toMatchObject({ ok: true, kind: "REGULATION_LIST", delimiter: "\t", rowCount: 2 });
  });

  it("受け付けない拡張子と空のファイルは止める", () => {
    expect(detectImportFile("x.xlsx", "")).toMatchObject({ ok: false, reason: "extension" });
    expect(detectImportFile("x.tsv", "\n\n")).toMatchObject({ ok: false, reason: "empty" });
  });
});
