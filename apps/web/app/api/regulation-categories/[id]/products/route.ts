import { jsonError, requirePermission } from "@/lib/authz";
import { getCurrentVersion } from "@/lib/current-version";
import { filterCompositionVisible } from "@/lib/composition-access";
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

  // 判定は法規制バージョンごとにあるので、現在のバージョンの行だけを見る
  const version = await getCurrentVersion();
  if (!version) return Response.json({ items: [] });
  /*
    根拠（組成に近い情報）を見せるのは、組成を見られる製品だけ（S31 仕様 10 章の 3 つの条件。製品ごとに違う）
  */
  const visibility = visibilityWhere(actor);
  const hitsFor: boolean | Set<string> = actor.isSystemAdmin
    ? true
    : await filterCompositionVisible(
        actor,
        (
          await prisma.productJudgement.findMany({
            where: {
              categoryId: id,
              versionId: version.id,
              product: { deletedAt: null, ...visibility },
            },
            select: { productId: true },
            distinct: ["productId"],
          })
        ).map((r) => r.productId),
      );
  return Response.json({
    items: await toMatchedProducts(id, visibility, hitsFor, version.id),
  });
}
