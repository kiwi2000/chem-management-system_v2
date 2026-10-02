import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { canEditComposition } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { visibilityWhere } from "@/lib/product-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/products/[id]/composition/pre-reaction/keep — 反応前組成が変わっても、反応後組成は「このままにする」（2026-10-03）。
 * 「反応前組成が変わった」印を消すだけ。反応後組成は変えない。組成を編集できる人
 */
export async function POST(_req: Request, { params }: Ctx) {
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

  await prisma.product.update({ where: { id }, data: { preReactionChangedAt: null } });
  await writeAudit({
    entity: "product_pre_reaction",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: {
      keptPostReaction: true,
      changedAt: product.preReactionChangedAt?.toISOString() ?? null,
    },
  });
  return Response.json({ ok: true });
}
