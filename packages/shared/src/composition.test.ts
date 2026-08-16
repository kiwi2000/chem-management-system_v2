import { describe, expect, it } from "vitest";
import { validateCompositionSum, type SumLine } from "./composition";
import { fromScaled, toScaled } from "./decimal";
import { getMessages } from "./i18n";
import { DEFAULT_SETTINGS, type AppSettings } from "./settings";

/**
 * 含有率の合計判定は、システム設定で結果が入れ替わる。
 * ここを崩すと「保存できるはずのものが保存できない」になるので、表で固定しておく。
 */
const m = getMessages("ja");

const settings = (over: Partial<AppSettings> = {}): AppSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
});

const line = (contentPct: string | null, isBalance = false): SumLine => ({
  contentPct,
  isBalance,
});

describe("小数の受け渡し", () => {
  it("文字列と整数を往復できる", () => {
    expect(toScaled("12.5")).toBe(12500000n);
    expect(fromScaled(12500000n)).toBe("12.5");
    expect(fromScaled(toScaled("0.000001") ?? 0n)).toBe("0.000001");
    expect(fromScaled(toScaled("100") ?? 0n)).toBe("100");
  });

  it("小数7桁と数値でない文字列は受け付けない", () => {
    expect(toScaled("0.0000001")).toBeNull();
    expect(toScaled("１２")).toBeNull();
    expect(toScaled("abc")).toBeNull();
  });

  /** 0.1 を3回足すと 0.30000000000000004 になる類の誤差が出ないこと */
  it("足し算で誤差が出ない", () => {
    const total = (toScaled("0.1") ?? 0n) * 3n;
    expect(fromScaled(total)).toBe("0.3");
  });
});

describe("validateCompositionSum", () => {
  it("空なら警告だけ", () => {
    const r = validateCompositionSum([], settings(), m);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([m.composition.warnEmpty]);
  });

  it("ちょうど100%なら何も出ない", () => {
    const r = validateCompositionSum([line("60"), line("40")], settings(), m);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.totalPct).toBe("100");
  });

  describe("残部の行がないとき", () => {
    const lines = [line("60"), line("30")]; // 合計 90%

    it("STRICT は足りないとエラー", () => {
      const r = validateCompositionSum(lines, settings({ compositionValidationMode: "STRICT" }), m);
      expect(r.errors).toEqual([m.composition.errorSumNot100("90")]);
    });

    it("STANDARD は足りないと警告（未開示の成分がある運用を許す）", () => {
      const r = validateCompositionSum(lines, settings(), m);
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([m.composition.warnSumUnder("90")]);
    });

    it("LENIENT は足りなくても何も出ない", () => {
      const r = validateCompositionSum(
        lines,
        settings({ compositionValidationMode: "LENIENT" }),
        m,
      );
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
    });

    it("100%超は LENIENT だけ警告で、他はエラー", () => {
      const over = [line("60"), line("50")];
      expect(validateCompositionSum(over, settings(), m).errors).toEqual([
        m.composition.warnSumOver("110"),
      ]);
      const lenient = validateCompositionSum(
        over,
        settings({ compositionValidationMode: "LENIENT" }),
        m,
      );
      expect(lenient.errors).toEqual([]);
      expect(lenient.warnings).toEqual([m.composition.warnSumOver("110")]);
    });

    it("許容誤差の内側なら通す", () => {
      const r = validateCompositionSum([line("99.995")], settings(), m);
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
    });
  });

  describe("残部の行があるとき", () => {
    it("100%との差が残部に入る", () => {
      const r = validateCompositionSum([line("60"), line("15.5"), line(null, true)], settings(), m);
      expect(r.errors).toEqual([]);
      expect(r.totalPct).toBe("75.5");
      expect(r.balancePct).toBe("24.5");
    });

    it("既知だけで100%を超えていればエラー（残部が負になるため）", () => {
      const r = validateCompositionSum([line("60"), line("50"), line(null, true)], settings(), m);
      expect(r.errors).toEqual([m.composition.errorBalanceNegative("110")]);
      expect(r.balancePct).toBe("0");
    });

    it("誤差の範囲で超えている分は 0 に丸める", () => {
      const r = validateCompositionSum([line("100.005"), line(null, true)], settings(), m);
      expect(r.errors).toEqual([]);
      expect(r.balancePct).toBe("0");
    });

    it("設定で禁止していればエラー", () => {
      const r = validateCompositionSum(
        [line("60"), line(null, true)],
        settings({ compositionBalanceAllowed: false }),
        m,
      );
      expect(r.errors).toEqual([m.composition.errorBalanceNotAllowed]);
    });

    it("2件以上あればエラー", () => {
      const r = validateCompositionSum(
        [line("60"), line(null, true), line(null, true)],
        settings(),
        m,
      );
      expect(r.errors).toContain(m.composition.errorBalanceMultiple);
    });
  });
});
