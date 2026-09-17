import type { AppSettings } from "@chem/shared";

/**
 * ログインは通ったが、**先に済ませてもらう用事**。
 *
 * ログインを断るのではなく、済ませるまで他の画面を出さない形にしている。
 * 断る形（未設定なら入れない）にすると、管理者自身が未設定のまま
 * 2要素認証を必須にした瞬間に**誰も入れなくなり、画面からは戻せない。**
 *
 * この形には穴が1つある。**パスワードを知っている相手が、本人より先に
 * 認証アプリを登録できる。**塞ぐには、
 *
 *   - 必須を入にする前に全員の登録を済ませる（穴の開く時間をゼロにする）
 *   - 登録をアクセス記録に残し、身に覚えのない登録に気づけるようにする
 *   - 接続元を絞る（`ALLOWED_IPS`）
 *
 * のうち上2つをこのシステムで行っている。
 */
export type PendingStep = "changePassword" | "setUpMfa";

/**
 * パスワードの有効期限が切れているか（2026-09-17 指示）。
 *
 * **持っていない人は対象外。**パスキーだけの人・まだ発行されていない人は
 * 変えるものが無いので、期限で止めると出口の無い画面に閉じ込めてしまう。
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export function passwordExpired(
  user: { passwordHash?: string | null; passwordChangedAt?: Date | null },
  settings: Pick<AppSettings, "passwordExpiryDays">,
): boolean {
  const days = settings.passwordExpiryDays;
  if (!days || days <= 0) return false;
  if (!user.passwordHash) return false;
  const changedAt = user.passwordChangedAt;
  // 起点が分からないものは期限切れにしない（変えた記録が残っていない古いデータ）
  if (!changedAt) return false;
  return Date.now() - changedAt.getTime() >= days * DAY_MS;
}

/**
 * 期限までの残り日数。**切れていれば 0 以下**を返す。
 * 期限なし・パスワードを持たない人・起点が分からない人は null
 */
export function passwordExpiresInDays(
  user: { passwordHash?: string | null; passwordChangedAt?: Date | null },
  settings: Pick<AppSettings, "passwordExpiryDays">,
): number | null {
  const days = settings.passwordExpiryDays;
  if (!days || days <= 0) return null;
  if (!user.passwordHash) return null;
  const changedAt = user.passwordChangedAt;
  if (!changedAt) return null;
  const expiresAt = changedAt.getTime() + days * DAY_MS;
  // 切り上げ。残り 12 時間でも「あと 1 日」と伝える（0 日と出すと、もう切れたように読める）
  return Math.ceil((expiresAt - Date.now()) / DAY_MS);
}

/**
 * 「あと何日」の予告を出すなら、その日数（2026-09-17 指示）。出さないなら null。
 *
 * **0 日前なら出さない。**切れたものは予告ではなく、変更の画面で止める
 */
export function passwordExpiryWarningDays(
  user: { passwordHash?: string | null; passwordChangedAt?: Date | null },
  settings: Pick<AppSettings, "passwordExpiryDays" | "passwordExpiryWarnDays">,
): number | null {
  const warn = settings.passwordExpiryWarnDays;
  if (!warn || warn <= 0) return null;
  const left = passwordExpiresInDays(user, settings);
  if (left === null || left <= 0) return null;
  return left <= warn ? left : null;
}

/** 用事ごとの行き先。ここに載っている画面だけは、用事が残っていても開ける */
export const PENDING_PATH: Record<PendingStep, string> = {
  changePassword: "/change-password",
  setUpMfa: "/mfa-setup",
};

/**
 * 済ませていない用事。無ければ null。
 *
 * **パスワードの変更が先。**初期パスワードのまま2要素認証を結び付けると、
 * その初期パスワードを知っている人が残ったまま守りを固めることになる。
 */
export function pendingStep(
  user: {
    mustChangePassword: boolean;
    mfaMethod: string;
    hasPasskey?: boolean;
    passwordHash?: string | null;
    passwordChangedAt?: Date | null;
  },
  settings: Pick<AppSettings, "mfaRequired" | "passwordExpiryDays">,
): PendingStep | null {
  if (user.mustChangePassword) return "changePassword";
  // 期限の切れたパスワードも、変えるまで先へ進ませない（2026-09-17 指示）
  if (passwordExpired(user, settings)) return "changePassword";
  /*
    **パスキーも済んだうちに入る。**端末を持っていることと、
    指紋やPINで本人だと確かめることの2つを、それだけで満たすため
  */
  if (settings.mfaRequired && user.mfaMethod !== "totp" && !user.hasPasskey) return "setUpMfa";
  return null;
}
