import { lawSchema, normalizeCode } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/laws/[id] */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.law.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = lawSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  const country = await prisma.country.findFirst({ where: { id: v.countryId, deletedAt: null } });
  if (!country) return jsonError(404, "not_found", m.errors.notFound);

  if (codeNormalized !== existing.codeNormalized) {
    const clash = await prisma.law.findFirst({ where: { codeNormalized, deletedAt: null } });
    if (clash) return jsonError(409, "duplicate_law_code", m.laws.duplicateCode(v.code));
  }

  await prisma.law.update({
    where: { id },
    data: {
      code: v.code,
      codeNormalized,
      countryId: v.countryId,
      nameOriginal: v.nameOriginal,
      nameLang: v.nameLang,
      nameJa: v.nameJa ?? null,
      nameEn: v.nameEn ?? null,
      displayOrder: v.displayOrder,
      note: v.note ?? null,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "laws",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameOriginal: v.nameOriginal, countryId: v.countryId },
  });
  return Response.json({ ok: true });
}

/** DELETE /api/laws/[id] — 論理削除。区分が残っているものは消せない */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.law.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  const categories = await prisma.regulationCategory.count({
    where: { lawId: id, deletedAt: null },
  });
  if (categories > 0) return jsonError(409, "referenced", m.laws.inUse(categories));

  await prisma.law.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedBy: actor.user.id,
      // 一意制約を空けるための退避。原文の code はそのまま残す
      codeNormalized: `${existing.codeNormalized}:${existing.id}`.slice(0, 64),
    },
  });

  await writeAudit({
    entity: "laws",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code, nameOriginal: existing.nameOriginal },
  });
  return Response.json({ ok: true });
}
