import { metalFactorSchema, normalizeCas } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { findSubstancesByCas } from "@/lib/metal-factor-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/metal-factors/[id] — CAS・金属元素・係数の変更 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.metalConversionFactor.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = metalFactorSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const casNormalized = normalizeCas(v.casNumber);

  // キー（CAS × 金属元素）を変えるときは、その組が空いているか確かめる
  const keyChanged =
    casNormalized !== existing.casNormalized || v.metalElement !== existing.metalElement;
  if (keyChanged) {
    const clash = await prisma.metalConversionFactor.findUnique({
      where: { casNormalized_metalElement: { casNormalized, metalElement: v.metalElement } },
    });
    if (clash && clash.deletedAt === null) {
      return jsonError(
        409,
        "duplicate_metal_factor",
        m.errors.duplicateMetalFactor(casNormalized, v.metalElement),
      );
    }
    // 論理削除済みの行が居座っている場合は、先に片付けてキーを空ける
    if (clash) await prisma.metalConversionFactor.delete({ where: { id: clash.id } });
  }

  await prisma.metalConversionFactor.update({
    where: { id },
    data: {
      casNumber: casNormalized,
      casNormalized,
      metalElement: v.metalElement,
      ratioPct: v.ratioPct,
      updatedBy: actor.user.id,
    },
  });

  const warnings: string[] = [];
  const matched = await findSubstancesByCas([casNormalized]);
  if ((matched.get(casNormalized) ?? []).length === 0) {
    warnings.push(m.metalFactors.warnUnknownCas);
  }

  await writeAudit({
    entity: "metal_conversion_factors",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { casNumber: casNormalized, metalElement: v.metalElement, ratioPct: v.ratioPct },
  });
  return Response.json({ ok: true, warnings });
}

/** DELETE /api/metal-factors/[id] — 論理削除（同じキーで登録し直すと復活する） */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.metalConversionFactor.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  await prisma.metalConversionFactor.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: actor.user.id },
  });

  await writeAudit({
    entity: "metal_conversion_factors",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { casNumber: existing.casNumber, metalElement: existing.metalElement },
  });
  return Response.json({ ok: true });
}
