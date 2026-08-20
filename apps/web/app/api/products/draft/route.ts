import { draftUpdateSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { canEditProduct, visibilityWhere } from "@/lib/product-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/products/draft — ドラフト／完成を切り替える。
 *
 * 保存（PUT）ではこのフラグを動かさず、この操作でだけ変える。
 * 「とりあえず保存しておく」と「他の人に使わせてよい」を、操作として分けるため。
 * 一覧からまとめて完成にできるよう、複数の ID を受け取る。
 */
export async function POST(req: Request) {
  const m = await getServerMessages();
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = draftUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const { ids, draftFlag } = parsed.data;

  // 見えないものは対象にしない。見えていても、無効・ドラフトは編集の権限を別に見る
  const targets = await prisma.product.findMany({
    where: { id: { in: ids }, deletedAt: null, ...visibilityWhere(actor) },
    select: { id: true, code: true, status: true, draftFlag: true, createdBy: true },
  });
  const allowed = targets.filter((t) => canEditProduct(actor, t));
  if (allowed.length === 0) return jsonError(403, "forbidden", m.errors.forbidden);

  await prisma.product.updateMany({
    where: { id: { in: allowed.map((t) => t.id) } },
    data: { draftFlag, updatedBy: actor.user.id },
  });

  for (const t of allowed) {
    await writeAudit({
      entity: "products",
      entityId: t.id,
      action: "update",
      actorId: actor.user.id,
      diff: { code: t.code, draftFlag },
    });
  }

  // 権限が足りずに飛ばした分は、件数の差で気づけるようにして返す
  return Response.json({ ok: true, updated: allowed.length, requested: ids.length });
}
