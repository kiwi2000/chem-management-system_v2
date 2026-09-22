import { jsonError, requireAdmin } from "@/lib/authz";
import { getCurrentVersion } from "@/lib/current-version";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { isDay, todayInJapan } from "@/lib/judgement-date";
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

export async function POST(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  // 判定対象日（YYYY-MM-DD）。省くと今日（2026-09-22 決定）
  const input = (await req.json().catch(() => ({}))) as { asOf?: unknown };
  const asOf = typeof input.asOf === "string" && input.asOf !== "" ? input.asOf : todayInJapan();
  if (!isDay(asOf)) return jsonError(400, "validation", m.validation.dateFormat);
  const started = startRejudge(actor.user.id, asOf);
  return Response.json(await body(), { status: started ? 200 : 409 });
}

async function body() {
  // 画面から起こしていない（スクリプトで流した）判定も含めて、いつのものかを見せる。
  // 判定は法規制バージョンごとにあるので、現在のバージョンの行で見る
  const version = await getCurrentVersion();
  const last = await prisma.productJudgement.aggregate({
    where: { versionId: version?.id ?? "" },
    _max: { computedAt: true },
    _min: { computedAt: true },
  });
  return {
    status: rejudgeStatus(),
    lastComputedAt: last._max.computedAt?.toISOString() ?? null,
    oldestComputedAt: last._min.computedAt?.toISOString() ?? null,
    today: todayInJapan(),
  };
}
