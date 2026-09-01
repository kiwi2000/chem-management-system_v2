import { normalizeCode, regulationCategorySchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { countSubstancesByCategory } from "@/lib/law-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/regulation-categories/[id] */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.regulationCategory.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = regulationCategorySchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  const law = await prisma.law.findFirst({ where: { id: v.lawId, deletedAt: null } });
  if (!law) return jsonError(404, "not_found", m.errors.notFound);

  if (codeNormalized !== existing.codeNormalized || v.lawId !== existing.lawId) {
    const clash = await prisma.regulationCategory.findFirst({
      where: { lawId: v.lawId, codeNormalized, deletedAt: null },
    });
    if (clash) {
      return jsonError(
        409,
        "duplicate_category_code",
        m.regulationCategories.duplicateCode(v.code),
      );
    }
  }

  await prisma.regulationCategory.update({
    where: { id },
    data: {
      code: v.code,
      codeNormalized,
      lawId: v.lawId,
      nameOriginal: v.nameOriginal,
      nameLang: v.nameLang,
      nameJa: v.nameJa ?? null,
      nameEn: v.nameEn ?? null,
      thresholdLower: v.thresholdLower,
      lowerBound: v.lowerBound,
      thresholdUpper: v.thresholdUpper,
      upperBound: v.upperBound,
      thresholdBasis: v.thresholdBasis,
      judged: v.judged,
      interactionGroup: v.interactionGroup ?? null,
      rank: v.rank ?? null,
      displayOrder: v.displayOrder,
      note: v.note ?? null,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "regulation_categories",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameOriginal: v.nameOriginal, lawId: v.lawId },
  });
  return Response.json({ ok: true });
}

/**
 * DELETE /api/regulation-categories/[id] — 論理削除。
 * 法文物質名が残っているものは消せない。名前のない分類は一緒に片付ける。
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.regulationCategory.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  const counts = await countSubstancesByCategory([id]);
  const substances = counts.get(id) ?? 0;
  if (substances > 0) {
    return jsonError(409, "referenced", m.regulationCategories.inUse(substances));
  }

  const now = new Date();
  await prisma.$transaction([
    // 中身のない分類は、区分と一緒に片付ける（残しても使い道がない）
    prisma.regulationClass.updateMany({
      where: { categoryId: id, deletedAt: null },
      data: { deletedAt: now, updatedBy: actor.user.id },
    }),
    prisma.regulationCategory.update({
      where: { id },
      data: {
        deletedAt: now,
        updatedBy: actor.user.id,
        codeNormalized: `${existing.codeNormalized}:${existing.id}`.slice(0, 64),
      },
    }),
  ]);

  await writeAudit({
    entity: "regulation_categories",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code, nameOriginal: existing.nameOriginal },
  });
  return Response.json({ ok: true });
}
