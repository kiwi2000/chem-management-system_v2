/**
 * 画面側の楽観的ロックの補助（サーバー側は lib/edit-stamp.ts）。
 *
 * 保存の応答が 409 `stale_edit` なら、誰がいつ先に変えたかを取り出す。
 * 画面は入力を残したまま StaleEditNotice（components/stale-edit-notice.tsx）を出し、
 * 「このまま保存する」なら `force: true` を付けて送り直す
 */

export interface StaleEditInfo {
  byName: string | null;
  at: string | null;
}

/** 409 の食い違いなら中身を、そうでなければ null。本文は 1 回しか読めないので、呼ぶ側はこの後で本文を読まない */
export async function readStaleEdit(res: Response): Promise<StaleEditInfo | null> {
  if (res.status !== 409) return null;
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as {
    error?: { code?: string; details?: { byName?: string | null; at?: string | null } };
  } | null;
  if (body?.error?.code !== "stale_edit") return null;
  return { byName: body.error.details?.byName ?? null, at: body.error.details?.at ?? null };
}
