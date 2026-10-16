import { propertyDefSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PROPERTY_DEF_COUNT, syncPropertyOptions, valueCountOf } from "@/lib/property-def-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/admin/property-defs/[id]
 * キーと用途は変更できない（入力済みの値との対応が切れるため）。
 * 種類（数値/テキスト/選択肢）も、値が既に入っている場合と、システムの項目では変更できない。
 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.propertyDef.findUnique({
    where: { id },
    include: PROPERTY_DEF_COUNT,
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = propertyDefSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  const dataType =
    (existing.systemFlag || valueCountOf(existing) > 0) && v.dataType !== existing.dataType
      ? existing.dataType // システムの項目と、入力済みの値がある項目は、種類を据え置く
      : v.dataType;
  if (dataType === "CHOICE" && v.valueOptions.filter((o) => o.activeFlag).length === 0) {
    return jsonError(400, "validation_error", m.propertyDefs.choiceNeedsOptions);
  }

  await prisma.$transaction(async (tx) => {
    await tx.propertyDef.update({
      where: { id },
      data: {
        labelJa: v.labelJa,
        labelEn: v.labelEn ?? null,
        dataType,
        defaultUnit: v.defaultUnit ?? null,
        displayOrder: v.displayOrder,
        activeFlag: v.activeFlag,
        group: v.group,
      },
    });
    // 選択肢でなくなった項目の値の選択肢は、並びを空にして片付ける（使われていれば「使わない」で残る）
    await syncPropertyOptions(tx, existing, "VALUE", dataType === "CHOICE" ? v.valueOptions : []);
    await syncPropertyOptions(tx, existing, "CONDITION", v.conditionOptions);
  });

  await writeAudit({
    entity: "property_defs",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { labelJa: v.labelJa, dataType, activeFlag: v.activeFlag },
  });
  return Response.json({ ok: true, dataTypeLocked: dataType !== v.dataType });
}

/** DELETE — 入力済みの値も一緒に消える（画面で件数を見せて確認する） */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.propertyDef.findUnique({ where: { id } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);
  // GHS 判定・SDS がキーで読むので、システムの項目は消させない（「使わない」にはできる）
  if (existing.systemFlag) {
    return jsonError(409, "system_property", m.propertyDefs.systemCannotDelete(existing.labelJa));
  }

  await prisma.propertyDef.delete({ where: { id } });

  await writeAudit({
    entity: "property_defs",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { target: existing.target, key: existing.key },
  });
  return Response.json({ ok: true });
}
