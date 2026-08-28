import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { visibilityWhere } from "@/lib/product-service";
import { toMatchedProducts } from "@/lib/judgement-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/regulation-categories/[id]/products — この区分に当たる製品（逆引き）。
 *
 * 「この法律に引っかかる製品はどれか」を、製品を1つずつ開かずに知るための口。
 *
 * 見せる範囲は製品の一覧と同じ規則にそろえる。
 * **見えない製品は件数にも入れない**（在ることが分かると、それだけで
 * 「この会社はこの規制物質を扱っている」と伝わってしまう）。
 *
 * 根拠（どのCASが何％効いたか）は組成に近い情報なので、
 * 組成を見られない人には伏せる。伏せたことは画面に伝える。
 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const category = await prisma.regulationCategory.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!category) return jsonError(404, "not_found", m.errors.notFound);

  return Response.json({
    /*
      製品ごとの権限ではなく権限そのもので決まる（canViewComposition と同じ規則）。
      ここは製品が複数なので、1件ずつ判断する形は取らない。
    */
    items: await toMatchedProducts(id, visibilityWhere(actor), actor.has("COMPOSITION_VIEW")),
  });
}
