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
  user: { mustChangePassword: boolean; mfaMethod: string },
  settings: Pick<AppSettings, "mfaRequired">,
): PendingStep | null {
  if (user.mustChangePassword) return "changePassword";
  if (settings.mfaRequired && user.mfaMethod !== "totp") return "setUpMfa";
  return null;
}
