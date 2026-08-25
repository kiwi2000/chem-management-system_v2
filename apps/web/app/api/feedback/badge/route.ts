import { isOpenFeedback, FEEDBACK_STATUSES } from "@chem/shared";
import { requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 未完了＝「完了」以外。共有の判定（isOpenFeedback）と食い違わないよう、そこから作る */
const OPEN_STATUSES = FEEDBACK_STATUSES.filter(isOpenFeedback);

/**
 * GET /api/feedback/badge — メニューに出す数。
 *
 * 未読 … 最後に見た時刻より後に書かれた・返事が付いたもの。自分が最後に触ったものは数えない
 * 未完了 … 「完了」になっていないもの
 *
 * 開発中の窓口なので、ログインしていれば誰でも数えられる（権限では絞らない）。
 */
export async function GET() {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { user } = actor;

  const [unread, open] = await Promise.all([
    prisma.feedback.count({
      where: {
        deletedAt: null,
        // 一度も開いていない人には全部が未読
        ...(user.feedbackSeenAt ? { updatedAt: { gt: user.feedbackSeenAt } } : {}),
        // 自分が書いた・自分が返事したものは、自分にとって未読ではない
        NOT: { updatedBy: user.id },
      },
    }),
    prisma.feedback.count({ where: { deletedAt: null, status: { in: OPEN_STATUSES } } }),
  ]);

  return Response.json({ unread, open });
}
