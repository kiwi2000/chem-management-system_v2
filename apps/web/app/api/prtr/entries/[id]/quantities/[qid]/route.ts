import { prtrQuantitySchema } from "@chem/shared";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requirePrtrOrg } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { isConfirmed, QUANTITY_INCLUDE, toQuantityDto } from "@/lib/prtr-service";

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
  const updated = await prisma.prtrQuantity.update({
    where: { id: qid },
    data: {
      purchasedKg: new Prisma.Decimal(v.purchasedKg),
      shippedKg: new Prisma.Decimal(v.shippedKg),
      source: "MANUAL",
      updatedBy: actor.user.id,
    },
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
  return Response.json({ item: toQuantityDto(updated) });
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
