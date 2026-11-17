"use client";

import { EXPIRED_LOGIN_URL, PENDING_HEADER } from "@/lib/routes";

/**
 * API が 401 を返したらログイン画面へ送る。
 *
 * 画面を開いたまま管理者に無効化された・期限が切れた、という場合は
 * 画面遷移が起きないのでサーバー側の判定が働かない。ここで拾う。
 *
 * **先に済ませる用事が残っているという断り（403）も、ここで用事の画面へ送る。**
 *
 * 戻り値が true なら遷移を始めているので、呼び出し側はそのまま return してよい。
 * `replace` を使うのは、戻るボタンで見られない画面に戻らせないため。
 */
export function redirectIfUnauthorized(res: Response): boolean {
  if (res.status === 401) {
    window.location.replace(EXPIRED_LOGIN_URL);
    return true;
  }
  return redirectIfPending(res);
}

/**
 * 先に済ませる用事（パスワードの変更・2要素認証の登録）が残っているという断りなら、用事の画面へ送る。
 *
 * 画面を開いている途中で用事ができた人（管理者が必須にした、パスワードの期限が切れた）は、
 * 画面を移っても外枠の判定が働かないので、読み込みの断りで気づく。
 *
 * **もう用事の画面にいるときは、何もしない。**用事の画面でも、枠の読み込み（人数・バッジ・写真）は同じ断りを受ける。
 * そこで送ると、用事の画面を読み込み直し続ける
 */
export function redirectIfPending(res: Response): boolean {
  if (res.status !== 403) return false;
  const to = res.headers.get(PENDING_HEADER);
  if (!to || !to.startsWith("/") || to.startsWith("//")) return false;
  if (window.location.pathname === to) return false;
  window.location.replace(to);
  return true;
}
