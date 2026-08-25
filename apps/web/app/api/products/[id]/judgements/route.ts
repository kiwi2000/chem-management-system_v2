import { jsonError, requirePermission } from "@/lib/authz";
import { canViewComposition } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { toJudgementDtos } from "@/lib/judgement-service";
import { visibilityWhere } from "@/lib/product-service";

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

  return Response.json({
    items: await toJudgementDtos(id, canViewComposition(actor, product)),
  });
}
