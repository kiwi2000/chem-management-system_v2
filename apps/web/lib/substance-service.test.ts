import type { AppSettings, Messages } from "@chem/shared";
import { DEFAULT_SETTINGS, getMessages } from "@chem/shared";
import { describe, expect, it } from "vitest";
import { validateCas } from "./substance-service";

/**
 * CAS欄の厳しさはシステム設定で切り替わる。
 * 4通りの組み合わせで「止める / 通す」が入れ替わるので、表で固定しておく。
 */
const m: Messages = getMessages("ja");

const settings = (casRequired: boolean, casFormatEnforced: boolean): AppSettings => ({
  ...DEFAULT_SETTINGS,
  casRequired,
  casFormatEnforced,
});

describe("validateCas", () => {
  describe("空欄", () => {
    it("必須にしていなければ通す", () => {
      expect(validateCas(null, settings(false, false), m)).toBeNull();
      expect(validateCas(null, settings(false, true), m)).toBeNull();
    });

    it("必須にしていれば止める", () => {
      expect(validateCas(null, settings(true, false), m)).toBe(m.errors.casRequired);
      expect(validateCas(null, settings(true, true), m)).toBe(m.errors.casRequired);
    });
  });

  describe("CASらしくない文字列", () => {
    it("形式を強制していなければ通す（警告は別で出す）", () => {
      expect(validateCas("POLY-0001", settings(false, false), m)).toBeNull();
      expect(validateCas("POLY-0001", settings(true, false), m)).toBeNull();
    });

    it("形式を強制していれば止める", () => {
      expect(validateCas("POLY-0001", settings(false, true), m)).toBe(m.errors.casFormatInvalid);
      expect(validateCas("POLY-0001", settings(true, true), m)).toBe(m.errors.casFormatInvalid);
    });
  });

  it("正しいCASはどの設定でも通す", () => {
    for (const s of [
      settings(false, false),
      settings(false, true),
      settings(true, false),
      settings(true, true),
    ]) {
      expect(validateCas("7439-92-1", s, m)).toBeNull();
    }
  });
});
