import { DEFAULT_SETTINGS, getMessages } from "@chem/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * パスキーで確かめて、今のパスワード無しでパスワードを作り直す（2026-11-18）。
 * 署名の検証そのものは道具（@simplewebauthn/server）に任せ、ここでは「だれの鍵なら通すか」
 * 「確かめられなかったら変えない」「今と同じかは確かめたあとに見る」を固定する。
 */
const s = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  keys: [] as { credentialId: string; transports: string | null }[],
  stored: null as Record<string, unknown> | null,
  challenge: "ch" as string | null,
  verified: true,
  userUpdate: vi.fn(async () => ({})),
  revoke: vi.fn(async () => {}),
  create: vi.fn(async () => {}),
  audits: [] as { diff: Record<string, unknown> }[],
  checkedSame: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({
  requireUser: async () => ({ user: s.user }),
  jsonError: (status: number, code: string, message: string, details?: unknown) =>
    Response.json({ error: { code, message, details } }, { status }),
}));
vi.mock("@/lib/i18n", () => ({ getServerMessages: async () => getMessages("ja") }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => DEFAULT_SETTINGS }));
vi.mock("@/lib/audit", () => ({
  writeAudit: async (row: { diff: Record<string, unknown> }) => {
    s.audits.push(row);
  },
}));
vi.mock("@/lib/auth", () => ({
  createSession: s.create,
  revokeAllSessions: s.revoke,
  hashPassword: async () => "new-hash",
  verifyPassword: async (_hash: string, plain: string) => {
    s.checkedSame();
    return plain === "Current-Pass-123";
  },
}));
vi.mock("@/lib/passkey", () => ({
  passkeysOf: async () => s.keys,
  keepChallenge: async () => {},
  takeChallenge: async () => {
    const c = s.challenge;
    s.challenge = null;
    return c;
  },
  rpId: async () => "localhost",
  expectedOrigin: async () => "http://localhost:3001",
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    passkey: { findUnique: async () => s.stored, update: async () => ({}) },
    user: { update: s.userUpdate },
  },
}));
vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: async (o: Record<string, unknown>) => ({ challenge: "ch", ...o }),
  verifyAuthenticationResponse: async () => ({
    verified: s.verified,
    authenticationInfo: { newCounter: 2 },
  }),
}));

const { POST, PUT } = await import("./route");

const NEW = "New-Pass-456789";
function put(body: Record<string, unknown>) {
  return PUT(
    new Request("http://localhost/api/auth/change-password/passkey", {
      method: "PUT",
      body: JSON.stringify({ response: { id: "cred-1" }, ...body }),
    }),
  );
}
async function code(res: Response) {
  return ((await res.json()) as { error?: { code: string } }).error?.code;
}

beforeEach(() => {
  s.user = { id: "u1", passwordHash: "old-hash" };
  s.keys = [{ credentialId: "cred-1", transports: "internal" }];
  s.stored = {
    id: "p1",
    userId: "u1",
    credentialId: "cred-1",
    publicKey: Buffer.from([1]),
    counter: 1n,
    transports: "internal",
    deviceLabel: "会社のPC",
  };
  s.challenge = "ch";
  s.verified = true;
  s.audits = [];
  s.userUpdate.mockClear();
  s.revoke.mockClear();
  s.create.mockClear();
  s.checkedSame.mockClear();
});

describe("パスキーでパスワードを作り直す", () => {
  it("本人の鍵で確かめられたら、今のパスワード無しで変わる", async () => {
    const res = await put({ newPassword: NEW, confirmPassword: NEW });
    expect(res.status).toBe(200);
    expect(s.userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: expect.objectContaining({ passwordHash: "new-hash", lockedUntil: null }),
    });
    // ほかの端末は切れ、自分は続く（今のパスワードで変えるときと同じ）
    expect(s.revoke).toHaveBeenCalledWith("u1");
    expect(s.create).toHaveBeenCalledWith("u1");
    expect(s.audits[0]?.diff).toMatchObject({ passwordChanged: true, method: "passkey" });
  });

  it("ほかの人の鍵では変えない", async () => {
    s.stored = { ...s.stored, userId: "someone-else" };
    const res = await put({ newPassword: NEW, confirmPassword: NEW });
    expect(res.status).toBe(401);
    expect(await code(res)).toBe("passkey_not_yours");
    expect(s.userUpdate).not.toHaveBeenCalled();
  });

  it("署名を確かめられなければ変えない", async () => {
    s.verified = false;
    const res = await put({ newPassword: NEW, confirmPassword: NEW });
    expect(res.status).toBe(401);
    expect(s.userUpdate).not.toHaveBeenCalled();
  });

  it("お題の期限が切れていたら変えない", async () => {
    s.challenge = null;
    const res = await put({ newPassword: NEW, confirmPassword: NEW });
    expect(await code(res)).toBe("challenge_expired");
    expect(s.userUpdate).not.toHaveBeenCalled();
  });

  it("今と同じかは、鍵を確かめたあとにしか見ない（ログインしたままの画面から試させない）", async () => {
    s.verified = false;
    await put({ newPassword: "Current-Pass-123", confirmPassword: "Current-Pass-123" });
    expect(s.checkedSame).not.toHaveBeenCalled();

    s.verified = true;
    s.challenge = "ch";
    const res = await put({ newPassword: "Current-Pass-123", confirmPassword: "Current-Pass-123" });
    expect(res.status).toBe(400);
    expect(s.checkedSame).toHaveBeenCalled();
    expect(s.userUpdate).not.toHaveBeenCalled();
  });

  it("確認の欄が食い違っていたら、お題を使わずに断る", async () => {
    const res = await put({ newPassword: NEW, confirmPassword: "different-9999" });
    expect(res.status).toBe(400);
    expect(s.challenge).toBe("ch");
    expect(s.userUpdate).not.toHaveBeenCalled();
  });

  it("パスキーを登録していない人には、お題を出さない", async () => {
    s.keys = [];
    const res = await POST();
    expect(await code(res)).toBe("no_passkey");
  });

  it("お題は本人の鍵だけを候補にする", async () => {
    const res = await POST();
    const body = (await res.json()) as { allowCredentials: { id: string }[] };
    expect(body.allowCredentials.map((c) => c.id)).toEqual(["cred-1"]);
  });
});
