import { describe, expect, it } from "vitest";
import { PENDING_PATH, pendingStep } from "./pending-step";

const user = (over: Partial<{ mustChangePassword: boolean; mfaMethod: string }> = {}) => ({
  mustChangePassword: false,
  mfaMethod: "none",
  ...over,
});

describe("済ませていない用事", () => {
  it("必須でなければ、2要素認証が未設定でも通す", () => {
    expect(pendingStep(user(), { mfaRequired: false })).toBeNull();
  });

  it("必須なら、未設定の人は登録へ送る", () => {
    expect(pendingStep(user(), { mfaRequired: true })).toBe("setUpMfa");
  });

  it("必須でも、登録済みの人は通す", () => {
    expect(pendingStep(user({ mfaMethod: "totp" }), { mfaRequired: true })).toBeNull();
  });

  it("パスワードの変更が先。両方あってもまず変更させる", () => {
    expect(pendingStep(user({ mustChangePassword: true }), { mfaRequired: true })).toBe(
      "changePassword",
    );
  });

  it("必須でなくても、パスワードの変更は求める", () => {
    expect(pendingStep(user({ mustChangePassword: true }), { mfaRequired: false })).toBe(
      "changePassword",
    );
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
    expect(pendingStep({ ...base, hasPasskey: true }, { mfaRequired: true })).toBeNull();
  });

  it("パスキーが無ければ、これまでどおり登録へ送る", () => {
    expect(pendingStep({ ...base, hasPasskey: false }, { mfaRequired: true })).toBe("setUpMfa");
  });

  it("パスキーがあっても、初期パスワードの変更のほうが先", () => {
    expect(
      pendingStep({ ...base, mustChangePassword: true, hasPasskey: true }, { mfaRequired: true }),
    ).toBe("changePassword");
  });
});
