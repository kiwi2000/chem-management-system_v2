import { requireUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/heartbeat — 「まだ使っています」をサーバーに伝える。
 *
 * 自動ログアウトはサーバー側の最終操作時刻で判定する。ところが画面を触っているだけでは
 * 通信が起きないので、長い入力の途中でサーバーが先に打ち切ってしまう。
 * 操作が続いているあいだ、画面から時々これを呼んで時計を進める。
 *
 * requireUser がセッションを引くとき、最終操作時刻が更新される（lib/auth.ts）。
 * ここで他に何かする必要はない。
 */
export async function POST() {
  // 放置での自動ログアウト。用事の途中でも時計は動かす
  const auth = await requireUser({ allowPending: true });
  if (auth instanceof Response) return auth;
  return Response.json({ ok: true });
}
