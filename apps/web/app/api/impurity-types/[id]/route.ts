import { IMPURITY_NONE, impurityTypeSchema, normalizeCode } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/impurity-types/[id] — 名前・説明の変更（組み込みも名前は変えられる） */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.impurityType.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = impurityTypeSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  // 組み込みのコードは判定の既定値に使っているので変えさせない（名前と説明は変えられる）
  if (existing.builtin && codeNormalized !== existing.codeNormalized) {
    return jsonError(409, "builtin", m.impurityTypes.builtinCode);
  }
  if (codeNormalized !== existing.codeNormalized) {
    const dup = await prisma.impurityType.findFirst({ where: { codeNormalized } });
    if (dup) return jsonError(409, "duplicate", m.impurityTypes.duplicateCode(v.code));
  }

  await prisma.impurityType.update({
    where: { id },
    data: {
      code: v.code,
      codeNormalized,
      nameJa: v.nameJa,
      nameEn: v.nameEn ?? null,
      note: v.note ?? null,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "impurity_types",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa },
  });
  return Response.json({ id });
}

/**
 * DELETE /api/impurity-types/[id] — 削除。
 *
 * 組み込み（0・1）は消せない。使っている物質があるときも、件数を示して断る。
 * 付け替えてから消してもらう（黙って物質の種別を 0 に戻すと、判定が静かに変わる）
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.impurityType.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);
  if (existing.builtin || id === IMPURITY_NONE) {
    return jsonError(409, "builtin", m.impurityTypes.builtinDelete);
  }

  const used = await prisma.substance.count({ where: { impurityTypeId: id, deletedAt: null } });
  if (used > 0) return jsonError(409, "in_use", m.impurityTypes.inUse(used));

  await prisma.impurityType.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: actor.user.id },
  });
  await writeAudit({
    entity: "impurity_types",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code },
  });
  return Response.json({ id });
}
