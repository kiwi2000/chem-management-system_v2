import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { rejudgeStatus, startRejudge } from "@/lib/rejudge-job";

export const dynamic = "force-dynamic";

/**
 * 全製品の判定のやり直し。管理者だけ。
 *
 * GET  … いまの進み具合と、DB に残っている判定の最終計算日時
 * POST … 開始する。裏で回るので、すぐに進み具合を返す。走っていれば 409
 */
export async function GET() {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  return Response.json(await body());
}

export async function POST() {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const started = startRejudge(actor.user.id);
  return Response.json(await body(), { status: started ? 200 : 409 });
}

async function body() {
  // 画面から起こしていない（スクリプトで流した）判定も含めて、いつのものかを見せる
  const last = await prisma.productJudgement.aggregate({
    _max: { computedAt: true },
    _min: { computedAt: true },
  });
  return {
    status: rejudgeStatus(),
    lastComputedAt: last._max.computedAt?.toISOString() ?? null,
    oldestComputedAt: last._min.computedAt?.toISOString() ?? null,
  };
}
