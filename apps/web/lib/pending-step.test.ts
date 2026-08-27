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
