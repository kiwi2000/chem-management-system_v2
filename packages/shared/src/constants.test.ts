import { describe, expect, it } from "vitest";
import { looksLikeCas, normalizeCas, normalizeCode } from "./constants";

/**
 * 正規化の単体テスト。
 * 法規制リンクと金属換算係数は物質IDではなく CAS で突合するため、
 * ここの取りこぼしがそのまま規制の見落としになる。表記ゆれを潰せているかを固定する。
 */

describe("normalizeCode", () => {
  it("前後の空白を落として大文字にする", () => {
    expect(normalizeCode("  ab-01 ")).toBe("AB-01");
  });

  it("全角の英数記号を半角に直す", () => {
    expect(normalizeCode("ＡＢ－０１")).toBe("AB-01");
  });
});

describe("normalizeCas", () => {
  it("そのままの形は変えない", () => {
    expect(normalizeCas("7439-92-1")).toBe("7439-92-1");
  });

  it("全角数字・全角ハイフンを半角に直す", () => {
    expect(normalizeCas("７４３９－９２－１")).toBe("7439-92-1");
  });

  it.each([
    ["7439‐92‐1", "U+2010 ハイフン"],
    ["7439‑92‑1", "U+2011 改行しないハイフン"],
    ["7439–92–1", "U+2013 enダッシュ"],
    ["7439—92—1", "U+2014 emダッシュ"],
    ["7439−92−1", "U+2212 マイナス記号"],
    ["7439ー92ー1", "U+30FC 長音"],
  ])("%s（%s）を半角ハイフンに揃える", (input) => {
    expect(normalizeCas(input)).toBe("7439-92-1");
  });

  it("半角・全角の空白を取り除く", () => {
    expect(normalizeCas(" 7439 - 92 -　1 ")).toBe("7439-92-1");
  });

  it("表記ゆれを混ぜても同じ値になる（突合できる）", () => {
    const variants = ["7439-92-1", "７４３９－９２－１", " 7439‐92 ‑ 1 ", "7439−92—1"];
    const normalized = new Set(variants.map(normalizeCas));
    expect(normalized.size).toBe(1);
  });
});

describe("looksLikeCas", () => {
  it.each(["50-00-0", "7439-92-1", "1234567-89-5"])("%s は CAS らしい", (v) => {
    expect(looksLikeCas(v)).toBe(true);
  });

  it.each(["POLY-0001", "7439-92", "abc", "", "12345678-92-1"])("%s は CAS らしくない", (v) => {
    expect(looksLikeCas(v)).toBe(false);
  });
});
