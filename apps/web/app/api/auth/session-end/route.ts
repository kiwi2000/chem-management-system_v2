import { sessionEndReason } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/session-end — 直前のログインが、なぜ切れたのか。
 *
 * ログイン画面が「一定時間操作がなかったため」「利用者の設定が変わったため」を
 * 言い分けるために使う。
 *
 * **Cookie は捨てない。**捨てると、その直後の画面移動で `?expired=1` が外れ、
 * ただの `/login` に着いて知らせが消える（実際にそうなった）。
 * 残っていても、そのセッションには終わった印が付いているので誰も入れない。
 * ログインし直せば新しいものに置き換わる。
 *
 * 認証を通さないルート（`authz-coverage.test.ts` の allowlist に入っている）。
 * ログインしていない人が呼ぶためのもの。返すのは理由の一語だけで、
 * 誰のセッションだったかは返さない。
 */
export async function GET() {
  return Response.json({ reason: await sessionEndReason() });
}
