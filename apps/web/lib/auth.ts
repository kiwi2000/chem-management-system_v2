import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { AUTH_POLICY, normalizeEmail } from "@chem/shared";
import type { User as AppUser } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/db";

/**
 * 認証（自前実装・外部サービスに一切依存しない）。
 * 設計方針（完全閉域運用のため）:
 * - パスワードは Argon2id でハッシュ化。生パスワードは保存も記録もしない。
 * - セッションは「推測不能な生トークンをCookie、SHA-256ハッシュをDB」に持つ。
 *   DBが漏れてもトークン原本は復元できない。
 * - 総当たり対策として連続失敗でロックアウト。
 */

/** Argon2id パラメータ（OWASP推奨水準） */
const ARGON_OPTS = {
  memoryCost: 19456, // 19MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, ARGON_OPTS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(hash, plain);
  } catch {
    return false;
  }
}

/** セッショントークン生成（生トークンとDB保存用ハッシュ） */
function newSessionToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: sha256(raw) };
}

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

/** タイミング攻撃に配慮した文字列比較 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface LoginFailure {
  ok: false;
  /** 画面表示用（アカウントの存在を推測させない共通文言を使う） */
  reason: "invalid" | "locked" | "inactive" | "mfa_required" | "mfa_invalid";
  lockedUntil?: Date;
}
export interface LoginSuccess {
  ok: true;
  user: AppUser;
  mustChangePassword: boolean;
}

/**
 * ログイン検証（試行回数の記録・ロックアウト込み）。
 * 成功時はセッションを発行しCookieへ保存する。
 */
export async function login(
  email: string,
  password: string,
  totp?: string,
): Promise<LoginSuccess | LoginFailure> {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  });

  // 存在しないユーザーでも同等の計算時間になるようダミー検証を行う（列挙対策）
  if (!user || !user.passwordHash) {
    await verifyPassword(
      "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$3T7v3sSDkYFRfR3o5xk8Ub0FR2Q1H0V0oTn8h3lM9Zc",
      password,
    );
    return { ok: false, reason: "invalid" };
  }
  if (user.deletedAt || !user.activeFlag) return { ok: false, reason: "inactive" };
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, reason: "locked", lockedUntil: user.lockedUntil };
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= AUTH_POLICY.maxFailedLogins;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock
          ? new Date(Date.now() + AUTH_POLICY.lockoutMinutes * 60_000)
          : user.lockedUntil,
      },
    });
    return lock ? { ok: false, reason: "locked" } : { ok: false, reason: "invalid" };
  }

  // MFA（TOTP）が有効なら検証
  if (user.mfaEnabled && user.mfaSecret) {
    if (!totp) return { ok: false, reason: "mfa_required" };
    const { verifyTotp } = await import("@/lib/totp");
    if (!verifyTotp(user.mfaSecret, totp)) return { ok: false, reason: "mfa_invalid" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await createSession(user.id);
  return { ok: true, user, mustChangePassword: user.mustChangePassword };
}

/** セッション発行＋Cookie設定 */
export async function createSession(userId: string): Promise<void> {
  const { raw, hash } = newSessionToken();
  const expiresAt = new Date(Date.now() + AUTH_POLICY.sessionHours * 3600_000);

  const hdrs = await headers();
  await prisma.session.create({
    data: {
      tokenHash: hash,
      userId,
      expiresAt,
      ipAddress: hdrs.get("x-forwarded-for") ?? null,
      userAgent: hdrs.get("user-agent")?.slice(0, 500) ?? null,
    },
  });

  const store = await cookies();
  store.set(AUTH_POLICY.sessionCookieName, raw, {
    httpOnly: true, // JavaScriptから読めない（XSS対策）
    secure: process.env.NODE_ENV === "production", // HTTPSのみ
    sameSite: "lax", // CSRF緩和
    path: "/",
    expires: expiresAt,
  });
}

/** ログアウト（DBのセッションを削除しCookieを破棄） */
export async function logout(): Promise<void> {
  const store = await cookies();
  const raw = store.get(AUTH_POLICY.sessionCookieName)?.value;
  if (raw) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256(raw) } });
  }
  store.delete(AUTH_POLICY.sessionCookieName);
}

/** そのユーザーの全セッションを失効（パスワード変更・無効化時に使用） */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

/**
 * 現在のリクエストのログインユーザー。
 * 無効なセッション・期限切れ・無効化ユーザーは null。
 *
 * 同じリクエストの中では何度呼んでも1回しか引かない（cache）。
 * 言語・テーマ・背景の解決でそれぞれ呼ぶため、素のままだと同じ問い合わせが並ぶ。
 */
export const getSessionUser = cache(async function getSessionUser(): Promise<AppUser | null> {
  const store = await cookies();
  const raw = store.get(AUTH_POLICY.sessionCookieName)?.value;
  if (!raw) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  const user = session.user;
  if (user.deletedAt || !user.activeFlag) return null;

  // 最終アクセス時刻の更新（頻繁な書き込みを避け5分間隔）
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
  }
  return user;
});

/** 期限切れセッションの掃除（ログイン時などに随時呼ぶ） */
export async function purgeExpiredSessions(): Promise<void> {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
}
