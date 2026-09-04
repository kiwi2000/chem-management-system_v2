import { jsonError, requirePermission } from "@/lib/authz";
import { canViewComposition } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { toJudgementDtos } from "@/lib/judgement-service";
import { visibilityWhere } from "@/lib/product-service";
import { premisesChangedAt } from "@/lib/rejudge-job";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/products/[id]/judgements — その製品の法規制判定。
 *
 * 判定そのものは「製品を見られる」人なら読める。
 * ただし**根拠（何が何％入っていたか）は組成に近い情報**なので、
 * 組成を見られない人には伏せる。伏せたことは画面に伝える
 * （空なのか伏せたのかが分からないと、入っていないと読まれてしまう）。
 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
  });
  if (!product) return jsonError(404, "not_found", m.errors.notFound);

  const items = await toJudgementDtos(id, canViewComposition(actor, product));

  /*
    **いつ・どの前提で出した判定か**を添える。
    法規制側のデータを変えても判定は自動でやり直されないので、
    計算日時より後に前提が変わっていれば「古い可能性がある」と画面で伝える
  */
  const current = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true, code: true },
  });
  const computedAt = items.reduce<string | null>(
    (acc, j) => (acc === null || j.computedAt > acc ? j.computedAt : acc),
    null,
  );
  const versionIds = [...new Set(items.map((j) => j.versionId))];
  const judgedVersion =
    versionIds.length === 1 && versionIds[0]
      ? await prisma.linkSetVersion.findUnique({
          where: { id: versionIds[0] },
          select: { code: true },
        })
      : null;
  const changedAt = current ? await premisesChangedAt(current.id) : null;
  const stale =
    items.length > 0 &&
    (versionIds.some((v) => v !== (current?.id ?? null)) ||
      (computedAt !== null && changedAt !== null && changedAt.toISOString() > computedAt));

  return Response.json({
    items,
    computedAt,
    // 判定に使ったバージョン。分からなければ null（以前の判定はバージョンを控えていない）
    versionCode: judgedVersion?.code ?? null,
    stale,
  });
}
