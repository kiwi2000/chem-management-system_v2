import { requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/sessions/count — いまログインしている人数。
 *
 * 左メニューの下に出す数字。**ログインしている人なら誰でも読める**が、
 * 返すのは人数だけ（誰がいるかは、管理者のセッション管理でだけ見せる）。
 * 同じ人が2つの端末から入っていても1人。休止中（最終操作から自動ログアウトの
 * 時間を過ぎたもの）は、次の操作で切れるので数えない
 */
export async function GET() {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  const now = new Date();
  const { sessionIdleMinutes } = await getAppSettings();
  const activeSince = new Date(now.getTime() - sessionIdleMinutes * 60_000);
  const rows = await prisma.session.findMany({
    where: { endedAt: null, expiresAt: { gt: now }, lastSeenAt: { gte: activeSince } },
    select: { userId: true },
    distinct: ["userId"],
  });
  return Response.json({ users: rows.length });
}
