import { describe, expect, it } from "vitest";
import { describePasswordPolicy, passwordSchema } from "./auth";
import { getMessages } from "./i18n";
import { DEFAULT_SETTINGS, pickPasswordPolicy, type PasswordPolicy } from "./settings";

/**
 * パスワードの決まりは管理者が設定で変えられる。
 * 厳しくしすぎて誰も通れない／緩すぎて素通りする、のどちらも困るので表で固定しておく。
 */
const m = getMessages("ja");

const policy = (over: Partial<PasswordPolicy> = {}): PasswordPolicy => ({
  ...pickPasswordPolicy(DEFAULT_SETTINGS),
  ...over,
});

const check = (value: string, p: PasswordPolicy) => passwordSchema(m, p).safeParse(value);

describe("passwordSchema", () => {
  it("既定は12文字以上の英字と数字", () => {
    expect(check("abcdefgh1234", policy()).success).toBe(true);
    expect(check("abcdefghijkl", policy()).success).toBe(false);
    expect(check("abc1", policy()).success).toBe(false);
  });

  describe("記号", () => {
    const req = (chars: string) =>
      policy({ passwordRequireSymbol: true, passwordSymbolChars: chars });

    it("並べた文字の中から1つ入っていれば通す", () => {
      expect(check("abcdefgh1234!", req("!@#")).success).toBe(true);
    });

    it("並べていない記号は記号として数えない", () => {
      expect(check("abcdefgh1234%", req("!@#")).success).toBe(false);
    });

    it("空にすると英数字と空白以外すべてを記号とみなす", () => {
      expect(check("abcdefgh1234%", req("")).success).toBe(true);
      expect(check("abcdefgh1234 ", req("")).success).toBe(false);
    });

    it("どの記号が使えるかをエラー文言に出す", () => {
      const r = check("abcdefgh1234", req("!@#"));
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.message).toContain("!@#");
    });
  });
});

describe("describePasswordPolicy", () => {
  it("使える記号を並べて見せる", () => {
    const text = describePasswordPolicy(
      m,
      policy({ passwordRequireSymbol: true, passwordSymbolChars: "!@#" }),
    );
    expect(text).toContain("!@#");
  });

  it("文字種を求めないときは長さだけを言う", () => {
    const text = describePasswordPolicy(
      m,
      policy({ passwordRequireLetter: false, passwordRequireDigit: false }),
    );
    expect(text).toContain("12");
    expect(text).not.toContain("記号");
  });
});
