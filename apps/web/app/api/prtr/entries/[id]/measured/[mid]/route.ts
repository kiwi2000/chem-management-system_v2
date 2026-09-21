import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requirePrtrOrg } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { MEASURED_INCLUDE, toMeasuredDto } from "@/lib/prtr-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; mid: string }> };

const KG = /^\d{1,15}(\.\d{1,3})?$/;

async function load(id: string, mid: string) {
  return prisma.prtrMeasured.findFirst({
    where: { id: mid, entryId: id },
    include: { ...MEASURED_INCLUDE, entry: true },
  });
}

/** PUT /api/prtr/entries/[id]/measured/[mid] — 実測値を直す（物質は変えない） */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const { id, mid } = await params;
  const m = await getServerMessages();

  const row = await load(id, mid);
  if (!row) return jsonError(404, "not_found", m.errors.notFound);
  const denied = await requirePrtrOrg(actor, row.entry.organisationId);
  if (denied) return denied;

  let body: { measuredKg?: unknown };
  try {
    body = (await req.json()) as { measuredKg?: unknown };
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const kg = typeof body.measuredKg === "string" ? body.measuredKg.trim() : "";
  if (!KG.test(kg)) {
    return jsonError(400, "validation_error", m.prtr.validation.kg, {
      fieldErrors: { measuredKg: [m.prtr.validation.kg] },
    });
  }
  const updated = await prisma.prtrMeasured.update({
    where: { id: mid },
    data: { measuredKg: new Prisma.Decimal(kg), source: "MANUAL", updatedBy: actor.user.id },
    include: MEASURED_INCLUDE,
  });
  await writeAudit({
    entity: "prtr_measured",
    entityId: mid,
    action: "update",
    actorId: actor.user.id,
    diff: { statutorySubstanceId: row.statutorySubstanceId, measuredKg: kg },
  });
  return Response.json({ item: toMeasuredDto(updated) });
}

/** DELETE /api/prtr/entries/[id]/measured/[mid] — 実測値を消す */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const { id, mid } = await params;
  const m = await getServerMessages();

  const row = await load(id, mid);
  if (!row) return jsonError(404, "not_found", m.errors.notFound);
  const denied = await requirePrtrOrg(actor, row.entry.organisationId);
  if (denied) return denied;

  await prisma.prtrMeasured.delete({ where: { id: mid } });
  await writeAudit({
    entity: "prtr_measured",
    entityId: mid,
    action: "delete",
    actorId: actor.user.id,
    diff: { statutorySubstanceId: row.statutorySubstanceId },
  });
  return Response.json({ id: mid });
}
