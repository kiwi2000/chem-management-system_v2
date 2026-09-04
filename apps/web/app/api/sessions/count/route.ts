import { requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/sessions/count — いまアクティブなセッションの数。
 *
 * 左メニューの下に出す数字。**ログインしている人なら誰でも読める**が、
 * 返すのは数だけ（誰がいるかは、管理者のセッション管理でだけ見せる）。
 * 端末ごとに1つ数える（セッション管理の表の「アクティブ」の行数と一致する）。
 * 休止中（最終操作から自動ログアウトの時間を過ぎたもの）は、次の操作で切れるので数えない
 */
export async function GET() {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  const now = new Date();
  const { sessionIdleMinutes } = await getAppSettings();
  const activeSince = new Date(now.getTime() - sessionIdleMinutes * 60_000);
  const sessions = await prisma.session.count({
    where: { endedAt: null, expiresAt: { gt: now }, lastSeenAt: { gte: activeSince } },
  });
  return Response.json({ sessions });
}
