import { prtrIndustrySchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/prtr/industries/[id] — 変更（PRTR 管理者） */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.prtrIndustry.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = prtrIndustrySchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  if (v.code !== existing.code) {
    if (await prisma.prtrIndustry.findFirst({ where: { code: v.code, deletedAt: null } })) {
      return jsonError(409, "duplicate", m.prtr.industries.duplicateCode(v.code));
    }
  }
  if (
    v.defaultMinisterId &&
    !(await prisma.prtrMinister.findFirst({ where: { id: v.defaultMinisterId, deletedAt: null } }))
  ) {
    return jsonError(400, "validation_error", m.errors.validation);
  }

  await prisma.prtrIndustry.update({
    where: { id },
    data: {
      code: v.code,
      name: v.name,
      defaultMinisterId: v.defaultMinisterId ?? null,
      active: v.active ?? existing.active,
    },
  });
  await writeAudit({
    entity: "prtr_industries",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, name: v.name },
  });
  return Response.json({ id });
}

/** DELETE /api/prtr/industries/[id] — 論理削除（PRTR 管理者） */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.prtrIndustry.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  await prisma.prtrIndustry.update({ where: { id }, data: { deletedAt: new Date() } });
  await writeAudit({
    entity: "prtr_industries",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code },
  });
  return Response.json({ id });
}
