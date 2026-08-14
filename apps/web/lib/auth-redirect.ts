"use client";

import { EXPIRED_LOGIN_URL } from "@/lib/routes";

/**
 * API が 401 を返したらログイン画面へ送る。
 *
 * 画面を開いたまま管理者に無効化された・期限が切れた、という場合は
 * 画面遷移が起きないのでサーバー側の判定が働かない。ここで拾う。
 *
 * 戻り値が true なら遷移を始めているので、呼び出し側はそのまま return してよい。
 * `replace` を使うのは、戻るボタンで見られない画面に戻らせないため。
 */
export function redirectIfUnauthorized(res: Response): boolean {
  if (res.status !== 401) return false;
  window.location.replace(EXPIRED_LOGIN_URL);
  return true;
}
