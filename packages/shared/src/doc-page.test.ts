import { describe, expect, it } from "vitest";
import {
  bandTextForPreview,
  bandTextToCssContent,
  resolveBandText,
  unknownBandPlaceholders,
  type BandVars,
} from "./doc-page";

const vars: BandVars = {
  at: new Date(2026, 8, 16, 9, 5, 0),
  template: "不使用証明書",
  target: "PR-001",
  user: "見本 太郎",
  locale: "ja",
};

describe("ヘッダー・フッターの差込み", () => {
  it("日本語でも英語でも同じ差込みになり、ページ番号は印のまま残る", () => {
    const out = resolveBandText("{テンプレート} {target} {日付} {page}/{総ページ}", vars);
    expect(bandTextForPreview(out, 2, 5)).toBe("不使用証明書 PR-001 2026/09/16 2/5");
  });

  it("日付は形を添えられ、英語の様式では既定の形が変わる", () => {
    expect(resolveBandText("{日付:YYYY-MM-DD} {時刻}", vars)).toBe("2026-09-16 09:05");
    expect(resolveBandText("{date} {datetime}", { ...vars, locale: "en" })).toBe(
      "2026-09-16 2026-09-16 09:05",
    );
  });

  it("知らない差込みはそのまま残し、名前を知らせる", () => {
    expect(resolveBandText("{なに} x", vars)).toBe("{なに} x");
    expect(unknownBandPlaceholders("{なに} {ページ}")).toEqual(["なに"]);
  });

  it("CSS の content に直せる（ページ番号は counter、引用符は逃がす）", () => {
    const css = bandTextToCssContent(resolveBandText('第 {ページ} 頁 "a"', vars));
    expect(css).toBe('"第 " counter(page) " 頁 \\"a\\""');
    expect(bandTextToCssContent("")).toBe('""');
  });
});
