import { beforeEach, describe, expect, it, vi } from "vitest";

// DB・設定・パスワードの確かめを差し替え、ログインの判断だけを見る
const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  mfaRequired: false,
  passkeys: 0,
  sessions: vi.fn(async () => ({})),
  audits: [] as { action: string; diff: { reason?: string } }[],
}));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  cache: <T>(f: T) => f,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));
vi.mock("@node-rs/argon2", () => ({
  verify: async (_hash: string, plain: string) => plain === "right-password",
  hash: async () => "hash",
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: async () => state.user, update: async () => ({}) },
    session: { create: state.sessions },
    passkey: { count: async () => state.passkeys },
  },
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: async (row: { action: string; diff: { reason?: string } }) => {
    state.audits.push(row);
  },
}));
vi.mock("@/lib/settings", () => ({
  getAppSettings: async () => ({
    mfaRequired: state.mfaRequired,
    maintenanceMode: false,
    passwordExpiryDays: 0,
  }),
}));
vi.mock("@/lib/ip-whois", () => ({ requestWhois: () => {} }));

import { login } from "@/lib/auth";

function person(over: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "a@example.test",
    passwordHash: "hash",
    activeFlag: true,
    deletedAt: null,
    lockedUntil: null,
    failedLoginCount: 0,
    mfaMethod: "none",
    mfaSecret: null,
    mustChangePassword: false,
    passwordChangedAt: null,
    ...over,
  };
}
const reasons = () => state.audits.map((a) => a.diff.reason);

/**
 * 2要素認証が必須のとき、パスキーだけを登録している人は、パスワードだけでは入れない（2026-11-17 利用者の指示）。
 * 前は、認証アプリを登録している人にだけコードを聞き、パスキーの有無は見ていなかった。
 * 必須にしていても、パスワードを知っているだけの相手が 2 つ目の確かめなしで入れた
 */
describe("2要素認証が必須のときの、パスワードでのログイン", () => {
  beforeEach(() => {
    state.user = person();
    state.mfaRequired = true;
    state.passkeys = 0;
    state.sessions.mockClear();
    state.audits.length = 0;
  });

  it("パスキーだけの人は断る（ログインは作らず、理由を記録に残す）", async () => {
    state.passkeys = 1;
    const r = await login("a@example.test", "right-password");
    expect(r).toEqual({ ok: false, reason: "passkey_required" });
    expect(state.sessions).not.toHaveBeenCalled();
    expect(reasons()).toEqual(["passkey_required"]);
  });

  it("パスキーだけの人でも、パスワードが違えば、ふつうの「合いません」（パスキーの有無を教えない）", async () => {
    state.passkeys = 1;
    const r = await login("a@example.test", "wrong-password");
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(reasons()).toEqual(["bad_password"]);
  });

  it("どちらも登録していない人は通す（登録の画面まで進んでもらう）", async () => {
    const r = await login("a@example.test", "right-password");
    expect(r.ok).toBe(true);
    expect(state.sessions).toHaveBeenCalledTimes(1);
  });

  it("認証アプリを登録している人は、今までどおりコードを聞く（パスキーも持っていても）", async () => {
    state.user = person({ mfaMethod: "totp", mfaSecret: "secret" });
    state.passkeys = 1;
    const r = await login("a@example.test", "right-password");
    expect(r).toEqual({ ok: false, reason: "mfa_required" });
    expect(state.sessions).not.toHaveBeenCalled();
  });

  it("必須でないときは、パスキーを持っていてもパスワードだけで入れる", async () => {
    state.mfaRequired = false;
    state.passkeys = 1;
    const r = await login("a@example.test", "right-password");
    expect(r.ok).toBe(true);
    expect(state.sessions).toHaveBeenCalledTimes(1);
  });
});
