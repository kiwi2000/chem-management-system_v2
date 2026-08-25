import { requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/feedback/seen — 「ここまで見た」と印を付ける。
 *
 * フィードバックの一覧を開いたときに1回だけ呼ぶ。
 * 一覧の行に出す未読の印は、この時刻を**更新する前**の値で決めるので、
 * 開いた直後の画面では未読が見えたまま残る（開いた瞬間に消えると何が新しかったか分からない）。
 */
export async function POST() {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  await prisma.user.update({
    where: { id: actor.user.id },
    data: { feedbackSeenAt: new Date() },
  });
  return Response.json({ ok: true });
}
