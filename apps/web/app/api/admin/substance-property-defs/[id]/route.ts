import { propertyDefSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/admin/substance-property-defs/[id]
 * キーは変更できない（入力済みの値との対応が切れるため）。
 * 種類（数値/テキスト）も、値が既に入っている場合は変更できない。
 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.substancePropertyDef.findUnique({
    where: { id },
    include: { _count: { select: { values: true } } },
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
    existing._count.values > 0 && v.dataType !== existing.dataType
      ? existing.dataType // 入力済みの値があるので種類は据え置く
      : v.dataType;

  await prisma.substancePropertyDef.update({
    where: { id },
    data: {
      labelJa: v.labelJa,
      labelEn: v.labelEn ?? null,
      dataType,
      defaultUnit: v.defaultUnit ?? null,
      displayOrder: v.displayOrder,
      activeFlag: v.activeFlag,
    },
  });

  await writeAudit({
    entity: "substance_property_defs",
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

  const existing = await prisma.substancePropertyDef.findUnique({ where: { id } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  await prisma.substancePropertyDef.delete({ where: { id } });

  await writeAudit({
    entity: "substance_property_defs",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { key: existing.key },
  });
  return Response.json({ ok: true });
}
