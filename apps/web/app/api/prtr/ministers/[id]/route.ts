import { prtrMinisterSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/prtr/ministers/[id] — 変更（PRTR 管理者） */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.prtrMinister.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = prtrMinisterSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  await prisma.prtrMinister.update({
    where: { id },
    data: { name: v.name, active: v.active ?? existing.active },
  });
  await writeAudit({
    entity: "prtr_ministers",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { name: v.name },
  });
  return Response.json({ id });
}

/** DELETE /api/prtr/ministers/[id] — 論理削除（PRTR 管理者）。業種の既定になっていれば断る */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.prtrMinister.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);
  const used = await prisma.prtrIndustry.count({
    where: { defaultMinisterId: id, deletedAt: null },
  });
  if (used > 0) return jsonError(409, "in_use", m.prtr.ministers.inUse(used));

  await prisma.prtrMinister.update({ where: { id }, data: { deletedAt: new Date() } });
  await writeAudit({
    entity: "prtr_ministers",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { name: existing.name },
  });
  return Response.json({ id });
}
