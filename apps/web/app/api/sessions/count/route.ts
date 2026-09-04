import { requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { rejudgeNeeded } from "@/lib/rejudge-job";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/sessions/count — いまアクティブなセッションの数。
 *
 * 左メニューの下に出す数字。**ログインしている人なら誰でも読める**が、
 * 返すのは数だけ（誰がいるかは、管理者のセッション管理でだけ見せる）。
 * 端末ごとに1つ数える（セッション管理の表の「アクティブ」の行数と一致する）。
 * 休止中（最終操作から自動ログアウトの時間を過ぎたもの）は、次の操作で切れるので数えない。
 *
 * **管理者にはあわせて「要再計算」も返す**（法規制のデータが変わってから、全製品の判定を
 * やり直していないか）。同じ 30 秒おきの問い合わせに相乗りさせ、画面の負担を増やさない。
 * 一般の利用者には押せるボタンが無いので null
 */
export async function GET() {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  const now = new Date();
  const { sessionIdleMinutes } = await getAppSettings();
  const activeSince = new Date(now.getTime() - sessionIdleMinutes * 60_000);
  const [sessions, needed] = await Promise.all([
    prisma.session.count({
      where: { endedAt: null, expiresAt: { gt: now }, lastSeenAt: { gte: activeSince } },
    }),
    actor.has("ADMIN") ? rejudgeNeeded() : Promise.resolve(null),
  ]);
  return Response.json({ sessions, rejudgeNeeded: needed });
}
