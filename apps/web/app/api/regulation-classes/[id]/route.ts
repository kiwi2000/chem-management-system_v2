import { normalizeCode, regulationClassSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { ensureDefaultClass } from "@/lib/law-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/regulation-classes/[id] — 名前と並び順を直す */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.regulationClass.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = regulationClassSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  if (codeNormalized !== existing.codeNormalized) {
    const clash = await prisma.regulationClass.findFirst({
      where: { categoryId: existing.categoryId, codeNormalized, deletedAt: null },
    });
    if (clash) {
      return jsonError(409, "duplicate_class_code", m.regulationClasses.duplicateCode(v.code));
    }
  }

  await prisma.regulationClass.update({
    where: { id },
    data: {
      code: v.code,
      codeNormalized,
      nameOriginal: v.nameOriginal ?? null,
      nameLang: v.nameLang ?? null,
      nameJa: v.nameJa ?? null,
      nameEn: v.nameEn ?? null,
      displayOrder: v.displayOrder,
      interactionGroup: v.interactionGroup ?? null,
      rank: v.rank ?? null,
      note: v.note ?? null,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "regulation_classes",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameOriginal: v.nameOriginal ?? null },
  });
  return Response.json({ ok: true });
}

/**
 * DELETE /api/regulation-classes/[id] — 論理削除。
 * ぶら下がる法文物質名も一緒に消える（画面で件数を示して確認したうえで呼ぶ）。
 * 消した結果0件になったら、名前のない分類を作り直す
 * （区分は必ず分類を1件以上持つ、という約束を保つため）。
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.regulationClass.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  const now = new Date();
  await prisma.$transaction([
    prisma.statutorySubstance.updateMany({
      where: { classId: id, deletedAt: null },
      data: { deletedAt: now, updatedBy: actor.user.id },
    }),
    prisma.regulationClass.update({
      where: { id },
      data: {
        deletedAt: now,
        updatedBy: actor.user.id,
        codeNormalized: `${existing.codeNormalized}:${existing.id}`.slice(0, 64),
      },
    }),
  ]);

  await ensureDefaultClass(existing.categoryId, actor.user.id);

  await writeAudit({
    entity: "regulation_classes",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code, nameOriginal: existing.nameOriginal },
  });
  return Response.json({ ok: true });
}
