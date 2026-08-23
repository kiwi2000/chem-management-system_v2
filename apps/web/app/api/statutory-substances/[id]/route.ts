import { normalizeCode, statutorySubstanceSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const toDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00.000Z`) : null);

/** PUT /api/statutory-substances/[id] */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.statutorySubstance.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = statutorySubstanceSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  const cls = await prisma.regulationClass.findFirst({ where: { id: v.classId, deletedAt: null } });
  if (!cls) return jsonError(404, "not_found", m.errors.notFound);

  if (codeNormalized !== existing.codeNormalized || v.classId !== existing.classId) {
    const clash = await prisma.statutorySubstance.findFirst({
      where: { classId: v.classId, codeNormalized, deletedAt: null },
    });
    if (clash) {
      return jsonError(
        409,
        "duplicate_substance_code",
        m.statutorySubstances.duplicateCode(v.code),
      );
    }
  }

  await prisma.statutorySubstance.update({
    where: { id },
    data: {
      code: v.code,
      codeNormalized,
      classId: v.classId,
      officialNumber: v.officialNumber ?? null,
      nameOriginal: v.nameOriginal,
      nameLang: v.nameLang,
      nameJa: v.nameJa ?? null,
      nameEn: v.nameEn ?? null,
      thresholdLower: v.thresholdLower,
      lowerBound: v.lowerBound,
      thresholdUpper: v.thresholdUpper,
      upperBound: v.upperBound,
      effectiveFrom: toDate(v.effectiveFrom),
      effectiveTo: toDate(v.effectiveTo),
      displayOrder: v.displayOrder,
      note: v.note ?? null,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "statutory_substances",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameOriginal: v.nameOriginal, classId: v.classId },
  });
  return Response.json({ ok: true });
}

/**
 * DELETE /api/statutory-substances/[id] — 論理削除。
 * CASリンクは版に属するので、ここでは触らない（版の側で入れ直す）。
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.statutorySubstance.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  await prisma.statutorySubstance.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedBy: actor.user.id,
      codeNormalized: `${existing.codeNormalized}:${existing.id}`.slice(0, 64),
    },
  });

  await writeAudit({
    entity: "statutory_substances",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code, nameOriginal: existing.nameOriginal },
  });
  return Response.json({ ok: true });
}
