import { prtrQuantitySchema } from "@chem/shared";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requirePrtrOrg } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { STAMP_SELECT, parseEditStamp, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { isConfirmed, QUANTITY_INCLUDE, toQuantityDto, updaterNames } from "@/lib/prtr-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; qid: string }> };

/** 行と、その頭を読み、所属を確かめる */
async function load(id: string, qid: string) {
  return prisma.prtrQuantity.findFirst({
    where: { id: qid, entryId: id },
    include: { ...QUANTITY_INCLUDE, entry: true },
  });
}

/** PUT /api/prtr/entries/[id]/quantities/[qid] — 取扱量・出荷量を直す（製品と区画は変えない）。確定中は断る */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const { id, qid } = await params;
  const m = await getServerMessages();

  const row = await load(id, qid);
  if (!row) return jsonError(404, "not_found", m.errors.notFound);
  const denied = await requirePrtrOrg(actor, row.entry.organisationId);
  if (denied) return denied;
  if (await isConfirmed(id)) return jsonError(409, "confirmed", m.prtr.locked);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  // 製品と区画は行のまま。本文からは数量だけを受ける
  const parsed = prtrQuantitySchema(m).safeParse({
    ...(body as object),
    productCode: row.product.code,
    method: row.method === "FACTOR" ? "FACTOR" : "BALANCE",
  });
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  // ほかの人が先に保存していないか（楽観的ロック。lib/edit-stamp.ts）。印が無ければ断る
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;
  // 印が合う行だけを直す。当たらなければ、ほかの人が先に保存している
  const hit = await prisma.prtrQuantity.updateMany({
    where: { id: qid, ...stampWhere(lock) },
    data: {
      purchasedKg: new Prisma.Decimal(v.purchasedKg),
      shippedKg: new Prisma.Decimal(v.shippedKg),
      source: "MANUAL",
      updatedBy: actor.user.id,
    },
  });
  if (hit.count === 0) {
    return staleFromRow(
      m,
      await prisma.prtrQuantity.findUnique({ where: { id: qid }, select: STAMP_SELECT }),
    );
  }
  const updated = await prisma.prtrQuantity.findUniqueOrThrow({
    where: { id: qid },
    include: QUANTITY_INCLUDE,
  });
  await writeAudit({
    entity: "prtr_quantities",
    entityId: qid,
    action: "update",
    actorId: actor.user.id,
    diff: {
      product: row.product.code,
      method: row.method,
      purchasedKg: v.purchasedKg,
      shippedKg: v.shippedKg,
    },
  });
  return Response.json({ item: toQuantityDto(updated, await updaterNames([updated])) });
}

/** DELETE /api/prtr/entries/[id]/quantities/[qid] — 数量を消す。確定中は断る */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const { id, qid } = await params;
  const m = await getServerMessages();

  const row = await load(id, qid);
  if (!row) return jsonError(404, "not_found", m.errors.notFound);
  const denied = await requirePrtrOrg(actor, row.entry.organisationId);
  if (denied) return denied;
  if (await isConfirmed(id)) return jsonError(409, "confirmed", m.prtr.locked);

  await prisma.prtrQuantity.delete({ where: { id: qid } });
  await writeAudit({
    entity: "prtr_quantities",
    entityId: qid,
    action: "delete",
    actorId: actor.user.id,
    diff: { product: row.product.code, method: row.method },
  });
  return Response.json({ id: qid });
}
