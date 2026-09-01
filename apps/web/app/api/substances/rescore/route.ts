import { writeAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/authz";
import { recomputeAllScores } from "@/lib/score-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/substances/rescore — 全物質のスコアとランクを計算し直す。
 *
 * 普段は要らない。**区分のスコアを保存したときも、段の表を入れ替えたときも自動で走る。**
 * これを使うのは、
 *   - CASリンクを外から入れ替えたあと（取り込みスクリプトを流したあと）
 *   - バージョンを切り替えたあと
 *   - 何かの拍子に合わなくなったとき
 *
 * 6万件を数え直して数秒で終わるので、途中経過は出さずに待たせる。
 */
export async function POST() {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const started = Date.now();
  const rescored = await recomputeAllScores();

  await writeAudit({
    entity: "substances",
    // 「計算し直した」に当たる区分が無いので、判定と同じ `determine` で記録する
    action: "determine",
    actorId: actor.user.id,
    diff: { rescored, ms: Date.now() - started },
  });

  return Response.json({ ok: true, rescored });
}
