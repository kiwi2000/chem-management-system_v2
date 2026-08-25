import { recordCompositionView } from "@/lib/access-log";
import { jsonError, requirePermission } from "@/lib/authz";
import { aggregateComposition } from "@/lib/composition-aggregate";
import { canViewComposition } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { visibilityWhere } from "@/lib/product-service";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/products/[id]/composition/aggregate
 *
 * 組成を末端の物質まで下ろし、同じCAS番号のものを足し合わせて返す。
 * 法規制の判定に使うのはこの値なので、木をたどる計算はサーバー側に置く
 * （画面で組み立てると、判定と表示で別々の計算になってしまう）。
 *
 * 見えかたの判定は1段のときと同じ。製品が見えなければ404、組成が非開示なら403。
 * 途中の原材料が見えない場合は止めずに、その枝を「開けなかった」として返す。
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
  if (!canViewComposition(actor, product)) {
    return jsonError(403, "forbidden", m.composition.withheld);
  }

  const settings = await getAppSettings();
  const result = await aggregateComposition(actor, id, settings, m);

  // 見たことを残す。末端まで下ろした表なので、持ち出されたときの重みは1段より大きい
  await recordCompositionView({
    productId: id,
    actorId: actor.user.id,
    lineCount: result.rows.length,
    expanded: true,
  });

  return Response.json(result);
}
