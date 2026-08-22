import { jsonError } from "@/lib/authz";
import { peekIdleRemainMs } from "@/lib/auth";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/session-status — 自動ログアウトまでの残り時間。
 *
 * 画面が裏にいるあいだ、ブラウザはタイマーを止める。戻ったときの残り時間は
 * 画面側の時計では当てにならないので、サーバーに聞き直すためのもの。
 *
 * **最終操作時刻には触らない**（peekIdleRemainMs）。
 * ここで触ってしまうと、確かめる行為そのものが延命になる。
 * そのため requireUser は通さない。認可の穴ではなく、意図した例外。
 */
export async function GET() {
  const remainMs = await peekIdleRemainMs();
  if (remainMs === null) {
    const m = await getServerMessages();
    return jsonError(401, "unauthorized", m.errors.unauthorized);
  }
  return Response.json({ remainMs });
}
