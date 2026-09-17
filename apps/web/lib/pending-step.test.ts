import { describe, expect, it } from "vitest";
import {
  PENDING_PATH,
  passwordExpired,
  passwordExpiresInDays,
  passwordExpiryWarningDays,
  pendingStep,
} from "./pending-step";

const user = (over: Partial<{ mustChangePassword: boolean; mfaMethod: string }> = {}) => ({
  mustChangePassword: false,
  mfaMethod: "none",
  ...over,
});

describe("済ませていない用事", () => {
  it("必須でなければ、2要素認証が未設定でも通す", () => {
    expect(pendingStep(user(), { mfaRequired: false, passwordExpiryDays: 0 })).toBeNull();
  });

  it("必須なら、未設定の人は登録へ送る", () => {
    expect(pendingStep(user(), { mfaRequired: true, passwordExpiryDays: 0 })).toBe("setUpMfa");
  });

  it("必須でも、登録済みの人は通す", () => {
    expect(
      pendingStep(user({ mfaMethod: "totp" }), { mfaRequired: true, passwordExpiryDays: 0 }),
    ).toBeNull();
  });

  it("パスワードの変更が先。両方あってもまず変更させる", () => {
    expect(
      pendingStep(user({ mustChangePassword: true }), { mfaRequired: true, passwordExpiryDays: 0 }),
    ).toBe("changePassword");
  });

  it("必須でなくても、パスワードの変更は求める", () => {
    expect(
      pendingStep(user({ mustChangePassword: true }), {
        mfaRequired: false,
        passwordExpiryDays: 0,
      }),
    ).toBe("changePassword");
  });

  it("行き先はすべての用事に用意されている", () => {
    for (const step of ["changePassword", "setUpMfa"] as const) {
      expect(PENDING_PATH[step]).toMatch(/^\//);
    }
  });
});

describe("パスキーも「済んだ」に入る", () => {
  const base = { mustChangePassword: false, mfaMethod: "none" };

  it("必須でも、パスキーを登録していれば通す", () => {
    expect(
      pendingStep({ ...base, hasPasskey: true }, { mfaRequired: true, passwordExpiryDays: 0 }),
    ).toBeNull();
  });

  it("パスキーが無ければ、これまでどおり登録へ送る", () => {
    expect(
      pendingStep({ ...base, hasPasskey: false }, { mfaRequired: true, passwordExpiryDays: 0 }),
    ).toBe("setUpMfa");
  });

  it("パスキーがあっても、初期パスワードの変更のほうが先", () => {
    expect(
      pendingStep(
        { ...base, mustChangePassword: true, hasPasskey: true },
        { mfaRequired: true, passwordExpiryDays: 0 },
      ),
    ).toBe("changePassword");
  });
});

describe("パスワードの有効期限", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const withPassword = (changedAt: Date) => ({
    mustChangePassword: false,
    mfaMethod: "none",
    passwordHash: "argon2...",
    passwordChangedAt: changedAt,
  });

  it("0 なら期限なし", () => {
    expect(passwordExpired(withPassword(daysAgo(9999)), { passwordExpiryDays: 0 })).toBe(false);
  });

  it("日数を過ぎたら期限切れ。手前なら切れない", () => {
    expect(passwordExpired(withPassword(daysAgo(91)), { passwordExpiryDays: 90 })).toBe(true);
    expect(passwordExpired(withPassword(daysAgo(89)), { passwordExpiryDays: 90 })).toBe(false);
  });

  it("パスワードを持たない人（パスキーだけ）は対象外", () => {
    const user = { passwordHash: null, passwordChangedAt: daysAgo(9999) };
    expect(passwordExpired(user, { passwordExpiryDays: 1 })).toBe(false);
  });

  it("期限が切れていたら、パスワード変更へ送る", () => {
    expect(
      pendingStep(withPassword(daysAgo(100)), { mfaRequired: false, passwordExpiryDays: 90 }),
    ).toBe("changePassword");
  });

  it("期限が切れていなければ、これまでどおり通す", () => {
    expect(
      pendingStep(withPassword(daysAgo(10)), { mfaRequired: false, passwordExpiryDays: 90 }),
    ).toBeNull();
  });

  it("期限切れは、2要素認証の登録より先", () => {
    expect(
      pendingStep(withPassword(daysAgo(100)), { mfaRequired: true, passwordExpiryDays: 90 }),
    ).toBe("changePassword");
  });
});

describe("期限前の予告", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const user = (changedAt: Date) => ({ passwordHash: "argon2...", passwordChangedAt: changedAt });
  const set = (passwordExpiryDays: number, passwordExpiryWarnDays: number) => ({
    passwordExpiryDays,
    passwordExpiryWarnDays,
  });

  it("残り日数は切り上げ。半端な時間でも「あと1日」と数える", () => {
    expect(passwordExpiresInDays(user(daysAgo(80)), set(90, 0))).toBe(10);
    expect(passwordExpiresInDays(user(daysAgo(89.5)), set(90, 0))).toBe(1);
  });

  it("期限なし・パスワードを持たない人は、残り日数を数えない", () => {
    expect(passwordExpiresInDays(user(daysAgo(80)), set(0, 14))).toBeNull();
    expect(
      passwordExpiresInDays({ passwordHash: null, passwordChangedAt: daysAgo(80) }, set(90, 14)),
    ).toBeNull();
  });

  it("0 日前なら知らせない", () => {
    expect(passwordExpiryWarningDays(user(daysAgo(89)), set(90, 0))).toBeNull();
  });

  it("知らせる日数の中に入ったら、残り日数を返す", () => {
    expect(passwordExpiryWarningDays(user(daysAgo(80)), set(90, 14))).toBe(10);
    // まだ手前なら出さない
    expect(passwordExpiryWarningDays(user(daysAgo(70)), set(90, 14))).toBeNull();
  });

  it("切れてしまったら予告ではなく、変更の画面で止める", () => {
    expect(passwordExpiryWarningDays(user(daysAgo(91)), set(90, 14))).toBeNull();
    expect(passwordExpired(user(daysAgo(91)), set(90, 14))).toBe(true);
  });
});
