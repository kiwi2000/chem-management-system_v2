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
  reason: "invalid" | "locked" | "inactive" | "mfa_required" | "mfa_invalid" | "maintenance";
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

  // メンテナンス中は管理者しか入れない。パスワードが合ってから断る（合っているかは漏らさない）
  if ((await getAppSettings()).maintenanceMode && !(await isAdminUser(user.id))) {
    await auditLoginFailure(email, "maintenance", user.id);
    return { ok: false, reason: "maintenance" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await createSession(user.id);
  return { ok: true, user, mustChangePassword: user.mustChangePassword };
}

/** システム管理者か。メンテナンス中に入れる人を決めるために引く */
export async function isAdminUser(userId: string): Promise<boolean> {
  const row = await prisma.userPermission.findFirst({
    where: { userId, permission: "ADMIN" },
    select: { userId: true },
  });
  return row !== null;
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
    // 期限を付けない（ブラウザを閉じたら消える）。ログインの寿命は DB 側の
    // expiresAt と自動ログアウトで決めるので、Cookie に期限を持たせる必要はない。
    // 期限を付けるとブラウザがディスクに残し、閉じて開き直しても入ったままになる
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
    await endSessions({ tokenHash: sha256(raw) }, "logout");
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

/**
 * セッションが切れた理由。ログイン画面で何と伝えるかを決める。
 *
 *   settings … 利用者の設定が変わった（管理者の変更・パスワード変更など）
 *   idle     … 一定時間操作が無かった
 *   expired  … 有効期限が切れた
 *   logout   … 自分でログアウトした（知らせることは無い）
 */
export type SessionEndReason =
  | "settings"
  | "idle"
  | "expired"
  | "logout"
  /** メンテナンスに入ったので、管理者以外を切った */
  | "maintenance"
  /** 管理者が「ログイン中のユーザー」の画面から切った */
  | "admin";

/**
 * セッションを終わらせる。**行は消さず、印を付けるだけ。**
 * 消すと「なぜ切れたのか」が残らず、ログイン画面で言い分けられなくなる。
 * 古くなった行は `purgeExpiredSessions` が後で片付ける。
 */
async function endSessions(
  where: { userId: string } | { tokenHash: string },
  reason: SessionEndReason,
): Promise<void> {
  await prisma.session
    .updateMany({
      where: { ...where, endedAt: null },
      data: { endedAt: new Date(), endedReason: reason },
    })
    .catch(() => {});
}

/**
 * そのユーザーの全セッションを失効。
 * 呼ばれるのは**設定が変わったとき**だけ（パスワード変更・権限変更・端末の解除）。
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  await endSessions({ userId }, "settings");
}

/** 管理者が指定のセッションを切る。行は消さず、理由を残す */
export async function endSessionById(id: string, reason: SessionEndReason): Promise<void> {
  await prisma.session
    .updateMany({
      where: { id, endedAt: null },
      data: { endedAt: new Date(), endedReason: reason },
    })
    .catch(() => {});
}

/**
 * メンテナンスに入るとき、管理者以外のセッションをまとめて切る。
 * 入れないだけでは、すでに入っている人が作業を続けてしまう
 */
export async function endNonAdminSessions(): Promise<number> {
  const admins = await prisma.userPermission.findMany({
    where: { permission: "ADMIN" },
    select: { userId: true },
  });
  const r = await prisma.session.updateMany({
    where: { endedAt: null, userId: { notIn: admins.map((a) => a.userId) } },
    data: { endedAt: new Date(), endedReason: "maintenance" },
  });
  return r.count;
}

/** いまの Cookie が指すセッションの id。自分の行を見分けるために使う */
export async function currentSessionId(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(AUTH_POLICY.sessionCookieName)?.value;
  if (!raw) return null;
  const row = await prisma.session.findUnique({
    where: { tokenHash: sha256(raw) },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * いま持っている Cookie のセッションが、なぜ切れたのか。
 * **触るだけ。**印を消したり Cookie を捨てたりはしない（呼ぶ側が決める）
 */
export async function sessionEndReason(): Promise<SessionEndReason | null> {
  const store = await cookies();
  const raw = store.get(AUTH_POLICY.sessionCookieName)?.value;
  if (!raw) return null;
  const row = await prisma.session.findUnique({
    where: { tokenHash: sha256(raw) },
    select: { endedReason: true },
  });
  return (row?.endedReason as SessionEndReason | null) ?? null;
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
  // すでに終わっているもの（設定の変更・自分でのログアウト）は通さない
  if (session.endedAt) return null;
  if (session.expiresAt < new Date()) {
    await endSessions({ tokenHash: session.tokenHash }, "expired");
    return null;
  }
  const user = session.user;
  if (user.deletedAt || !user.activeFlag) return null;

  const { sessionIdleMinutes, maintenanceMode } = await getAppSettings();
  /*
   * メンテナンス中は管理者以外を通さない。**入れないだけでなく、入っている人も切る。**
   * 入ったときに切っているが、その後に入った人・切り損ねた人もここで止まる
   */
  if (maintenanceMode && !(await isAdminUser(user.id))) {
    await endSessions({ tokenHash: session.tokenHash }, "maintenance");
    return null;
  }

  /*
   * 操作が無いまま一定時間が過ぎていたら打ち切る。
   * 席を離れた端末が開いたままになるのを防ぐ。時間はシステム設定で決める。
   */
  const idleMs = Date.now() - session.lastSeenAt.getTime();
  if (idleMs > sessionIdleMinutes * 60_000) {
    await endSessions({ tokenHash: session.tokenHash }, "idle");
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
  if (session.endedAt) return null;
  if (session.expiresAt < new Date()) return null;
  if (session.user.deletedAt || !session.user.activeFlag) return null;

  const { sessionIdleMinutes } = await getAppSettings();
  const remain = sessionIdleMinutes * 60_000 - (Date.now() - session.lastSeenAt.getTime());
  return remain > 0 ? remain : null;
}

/**
 * 古いセッションの掃除（ログイン時などに随時呼ぶ）。
 *
 * **すぐには消さない。**切れた理由をログイン画面で伝えるため、しばらく残す。
 * 消すのは、終わってから（あるいは期限が切れてから）7日を過ぎたものだけ。
 */
const KEEP_ENDED_DAYS = 7;

export async function purgeExpiredSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - KEEP_ENDED_DAYS * 86400_000);
  await prisma.session
    .deleteMany({
      where: {
        OR: [{ endedAt: { lt: cutoff } }, { endedAt: null, expiresAt: { lt: cutoff } }],
      },
    })
    .catch(() => {});
}
