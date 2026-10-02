import { recordCompositionView } from "@/lib/access-log";
import { jsonError, requirePermission } from "@/lib/authz";
import { aggregateComposition } from "@/lib/composition-aggregate";
import { canEditComposition } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { loadPreRootLines, postStartLines } from "@/lib/pre-reaction-refresh";
import { visibilityWhere } from "@/lib/product-service";
import type { CompositionLineDto } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/products/[id]/composition/pre-reaction/draft — 「反応前組成をコピーしてから編集する」の下書き（2026-10-03）。
 *
 * 反応前組成（写し）のいまの原材料展開・CAS 合算から、反応後の出発点の行を作って返す
 * （「反応後の組成入力」と同じ作りかた）。**何も保存しない。**画面はこの行を編集の欄に入れ、
 * 利用者が保存したときに反応後組成が置き換わる。キャンセルすればいまの反応後組成のまま
 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
  });
  if (!product) return jsonError(404, "not_found", m.errors.notFound);
  if (!canEditComposition(actor, product)) {
    return jsonError(403, "forbidden", m.composition.withheldEdit);
  }
  if (!product.preReactionAt) return jsonError(404, "not_found", m.errors.notFound);

  const rootLines = await loadPreRootLines(id);
  const agg = await aggregateComposition(actor, id, { rootLines });
  const next = await postStartLines(agg);

  // 画面の行に要る名前・CAS を引く
  const substanceIds = next.flatMap((l) => (l.substanceId ? [l.substanceId] : []));
  const childIds = next.flatMap((l) => (l.childProductId ? [l.childProductId] : []));
  const [substances, children] = await Promise.all([
    prisma.substance.findMany({
      where: { id: { in: substanceIds } },
      select: { id: true, code: true, nameJa: true, nameEn: true, casNumber: true },
    }),
    prisma.product.findMany({
      where: { id: { in: childIds } },
      select: {
        id: true,
        code: true,
        nameJa: true,
        nameEn: true,
        _count: { select: { compositionLines: true } },
      },
    }),
  ]);
  const substanceOf = new Map(substances.map((s) => [s.id, s]));
  const childOf = new Map(children.map((c) => [c.id, c]));
  const lines: CompositionLineDto[] = next.map((l) => {
    const s = l.substanceId ? substanceOf.get(l.substanceId) : undefined;
    const c = l.childProductId ? childOf.get(l.childProductId) : undefined;
    return {
      id: "",
      substanceId: l.substanceId,
      childProductId: l.childProductId,
      contentPct: l.contentPct,
      note: l.note,
      element: s
        ? {
            id: s.id,
            code: s.code,
            nameJa: s.nameJa,
            nameEn: s.nameEn,
            casNumber: s.casNumber,
            hasComposition: false,
          }
        : c
          ? {
              id: c.id,
              code: c.code,
              nameJa: c.nameJa,
              nameEn: c.nameEn,
              casNumber: null,
              hasComposition: c._count.compositionLines > 0,
            }
          : null,
    };
  });

  // 末端まで下ろした表を返すので、見たことを残す
  await recordCompositionView({
    productId: id,
    actorId: actor.user.id,
    lineCount: lines.length,
    expanded: true,
  });
  return Response.json({ lines });
}
