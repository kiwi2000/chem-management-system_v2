import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { AUTH_POLICY, normalizeEmail } from "@chem/shared";
import type { User as AppUser } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { clientIp } from "@/lib/ip-allow";

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
/**
 * 誰がどこから触ったか。監査に残すためだけのもの。
 * 取れなくても認証の流れは止めない。
 */
async function callerInfo(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const hdrs = await headers();
    return {
      ip: clientIp(hdrs.get("x-forwarded-for")),
      userAgent: hdrs.get("user-agent")?.slice(0, 200) ?? null,
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * ログインに失敗したことを残す。
 *
 * 攻撃されたとき、あとから「いつ・どこから・どの口座を狙われたか」を追えるようにする。
 * **入力されたパスワードは絶対に残さない。**残すと、記録そのものが漏洩源になる。
 *
 * 存在しない利用者のぶんも残す。書き込みの時間が失敗の種類によって変わると、
 * そこから口座の有無を当てられてしまうため、どの道でも同じだけ書く。
 */
async function auditLoginFailure(email: string, reason: string, userId?: string): Promise<void> {
  const { ip, userAgent } = await callerInfo();
  await writeAudit({
    entity: "users",
    entityId: userId,
    action: "login_failed",
    actorId: userId,
    diff: { email: normalizeEmail(email), reason, ip, userAgent },
  });
}

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
    await auditLoginFailure(email, "unknown_user");
    return { ok: false, reason: "invalid" };
  }
  if (user.deletedAt || !user.activeFlag) {
    await auditLoginFailure(email, "inactive", user.id);
    return { ok: false, reason: "inactive" };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await auditLoginFailure(email, "locked_out", user.id);
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
    // ロックがかかった瞬間は、後から追えるよう別の理由で残す
    await auditLoginFailure(email, lock ? "locked_now" : "bad_password", user.id);
    return lock ? { ok: false, reason: "locked" } : { ok: false, reason: "invalid" };
  }

  // MFA（TOTP）が有効なら検証
  if (user.mfaMethod === "totp" && user.mfaSecret) {
    if (!totp) return { ok: false, reason: "mfa_required" };
    const { verifyTotp } = await import("@/lib/totp");
    if (!verifyTotp(user.mfaSecret, totp)) {
      // パスワードは合っていて2要素だけ違う。乗っ取りが進みかけている合図なので必ず残す
      await auditLoginFailure(email, "bad_totp", user.id);
      return { ok: false, reason: "mfa_invalid" };
    }
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
      ipAddress: clientIp(hdrs.get("x-forwarded-for")),
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
    // 誰のセッションだったかは、消す前でないと分からない
    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256(raw) },
      select: { userId: true },
    });
    await prisma.session.deleteMany({ where: { tokenHash: sha256(raw) } });
    if (session) {
      await writeAudit({
        entity: "users",
        entityId: session.userId,
        action: "logout",
        actorId: session.userId,
        // 成功・失敗と揃える。どこから出たかも記録の手がかりになる
        diff: await callerInfo(),
      });
    }
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

  /*
   * 操作が無いまま一定時間が過ぎていたら打ち切る。
   * 席を離れた端末が開いたままになるのを防ぐ。時間はシステム設定で決める。
   */
  const { sessionIdleMinutes } = await getAppSettings();
  const idleMs = Date.now() - session.lastSeenAt.getTime();
  if (idleMs > sessionIdleMinutes * 60_000) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  /*
   * 最終アクセス時刻の更新。
   * 毎回書くと無駄が多いので少し間引くが、間引きすぎると打ち切りが早まる
   * （最後の操作ではなく、最後に書いた時刻からの経過で見ることになるため）。
   * 30秒なら、実際の無操作時間とのずれはその範囲に収まる。
   */
  if (idleMs > 30_000) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
  }
  return user;
});

/**
 * 自動ログアウトまでの残りミリ秒。無効なセッションなら null。
 *
 * **最終操作時刻には触らない。**見ただけで時間が延びてしまうと、
 * 「画面に戻ったときに確かめる」ことがそのまま延命になってしまう。
 */
export async function peekIdleRemainMs(): Promise<number | null> {
  const store = await cookies();
  const raw = store.get(AUTH_POLICY.sessionCookieName)?.value;
  if (!raw) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { user: { select: { deletedAt: true, activeFlag: true } } },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) return null;
  if (session.user.deletedAt || !session.user.activeFlag) return null;

  const { sessionIdleMinutes } = await getAppSettings();
  const remain = sessionIdleMinutes * 60_000 - (Date.now() - session.lastSeenAt.getTime());
  return remain > 0 ? remain : null;
}

/** 期限切れセッションの掃除（ログイン時などに随時呼ぶ） */
export async function purgeExpiredSessions(): Promise<void> {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
}
