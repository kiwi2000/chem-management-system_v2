import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOC_FILE_NAME_PATTERN,
  buildDocFileName,
  formatDate,
  sanitizeFileName,
  unknownFileNamePlaceholders,
} from "./doc-file-name";

const at = new Date(2026, 8, 16, 9, 5, 7); // 2026-09-16 09:05:07

const vars = {
  template: "DOC-ROHS",
  code: "PR-001",
  name: "接着剤 A/B",
  version: "2026Q3",
  seq: 3,
  at,
};

describe("buildDocFileName", () => {
  it("既定の書式は テンプレート_対象コード_日付", () => {
    expect(buildDocFileName(DEFAULT_DOC_FILE_NAME_PATTERN, vars)).toBe("DOC-ROHS_PR-001_20260916");
  });

  it("日付と時刻の形を指定できる。英語の名前も同じ", () => {
    expect(buildDocFileName("{date:YYYY-MM-DD}_{time:HHmm}", vars)).toBe("2026-09-16_0905");
    expect(buildDocFileName("{日付:YY年MM月DD日}", vars)).toBe("26年09月16日");
  });

  it("通番は桁数を指定できる", () => {
    expect(buildDocFileName("{通番:3}", vars)).toBe("003");
    expect(buildDocFileName("{seq}", vars)).toBe("3");
  });

  it("ファイル名に使えない文字は _ になる", () => {
    expect(buildDocFileName("{対象名}", vars)).toBe("接着剤 A_B");
    expect(sanitizeFileName(' a:b*c?"<>| ')).toBe("a_b_c_____");
  });

  it("差込みが全部空でも、対象コードで補う", () => {
    expect(buildDocFileName("{version}", { ...vars, version: "" })).toBe("PR-001");
  });

  it("知らない差込みは検査で見つかる", () => {
    expect(unknownFileNamePlaceholders("{テンプレート}_{会社}_{x}")).toEqual(["会社", "x"]);
    expect(unknownFileNamePlaceholders(DEFAULT_DOC_FILE_NAME_PATTERN)).toEqual([]);
  });

  it("formatDate は知らない文字をそのまま残す", () => {
    expect(formatDate(at, "YYYYMMDD-HHmmss")).toBe("20260916-090507");
  });
});
