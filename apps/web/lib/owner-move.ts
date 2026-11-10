import { writeAudit } from "@/lib/audit";
import { jsonError, type Actor } from "@/lib/authz";
import { productsUsing } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { canMoveOwner } from "@/lib/owner-group";
import { visibilityWhere as productVisibility } from "@/lib/product-service";
import { visibilityWhere as substanceVisibility } from "@/lib/substance-service";

/**
 * 所属先の変更（S31 仕様 7 章・画面設計 8 章）。
 * 今の所属先と移す先の両方に「編集」の印が要る（システム管理グループは印に関係なく移せる）。
 * 原材料・物質は、それを組成に使っている製品の数を出して確かめる（止めはしない）
 */
export type OwnerTarget = "product" | "substance";

async function load(actor: Actor, target: OwnerTarget, id: string) {
  return target === "product"
    ? prisma.product.findFirst({
        where: { id, deletedAt: null, ...productVisibility(actor) },
        select: { id: true, code: true, ownerGroupId: true },
      })
    : prisma.substance.findFirst({
        where: { id, deletedAt: null, ...substanceVisibility(actor) },
        select: { id: true, code: true, ownerGroupId: true },
      });
}

/** GET: 使っている製品の数（確かめの文に出す） */
export async function ownerMoveInfo(actor: Actor, target: OwnerTarget, id: string) {
  const m = await getServerMessages();
  const row = await load(actor, target, id);
  if (!row) return jsonError(404, "not_found", m.errors.notFound);
  const users = await productsUsing(
    target === "product" ? { childProductId: id } : { substanceId: id },
  );
  return Response.json({ ownerGroupId: row.ownerGroupId, usedBy: users.length });
}

/** POST: 移す。{ ownerGroupId } */
export async function moveOwner(actor: Actor, target: OwnerTarget, id: string, req: Request) {
  const m = await getServerMessages();
  const row = await load(actor, target, id);
  if (!row) return jsonError(404, "not_found", m.errors.notFound);
  const body = (await req.json().catch(() => null)) as { ownerGroupId?: unknown } | null;
  const to = typeof body?.ownerGroupId === "string" ? body.ownerGroupId : "";
  const exists = await prisma.permissionGroup.findFirst({
    where: { id: to, isSystemAdmin: false },
    select: { id: true },
  });
  if (!exists) return jsonError(400, "validation_error", m.owner.notAllowed);
  const mark = target === "product" ? "productEdit" : "substanceEdit";
  if (!canMoveOwner(actor, mark, row.ownerGroupId, to)) {
    return jsonError(403, "forbidden", m.owner.notAllowed);
  }
  if (to === row.ownerGroupId) return Response.json({ ok: true });
  if (target === "product") {
    await prisma.product.update({
      where: { id },
      data: { ownerGroupId: to, updatedBy: actor.user.id },
    });
  } else {
    await prisma.substance.update({
      where: { id },
      data: { ownerGroupId: to, updatedBy: actor.user.id },
    });
  }
  await writeAudit({
    entity: target === "product" ? "products" : "substances",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { ownerGroupId: { from: row.ownerGroupId, to } },
  });
  // 移したあと自分が見られなくなったかを返す（画面は一覧へ戻す）
  const stillVisible = (await load(actor, target, id)) !== null;
  return Response.json({ ok: true, stillVisible });
}
