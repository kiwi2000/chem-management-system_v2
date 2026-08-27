import { inventorySchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { currentVersion } from "@/lib/inventory-service";
import type { InventoryDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/inventories/[id] — インベントリ1件 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  const { id } = await ctx.params;

  const item = await prisma.inventory.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      code: true,
      countryId: true,
      nameOriginal: true,
      nameJa: true,
      nameEn: true,
      numberLabel: true,
      numberOrder: true,
      numberShown: true,
      updatedAt: true,
      country: { select: { nameJa: true, nameEn: true } },
    },
  });
  if (!item) return jsonError(404, "not_found", m.errors.notFound);

  const version = await currentVersion();
  const rowCount = version
    ? await prisma.inventoryRow.count({ where: { versionId: version.id, inventoryId: id } })
    : 0;

  const dto: InventoryDto = {
    id: item.id,
    code: item.code,
    countryId: item.countryId,
    countryNameJa: item.country.nameJa,
    countryNameEn: item.country.nameEn,
    nameOriginal: item.nameOriginal,
    nameJa: item.nameJa,
    nameEn: item.nameEn,
    numberLabel: item.numberLabel,
    numberOrder: item.numberOrder,
    numberShown: item.numberShown,
    rowCount,
    updatedAt: item.updatedAt.toISOString(),
  };
  return Response.json({ item: dto, version: version ? { code: version.code } : null });
}

/**
 * PUT /api/inventories/[id] — インベントリの設定を直す。
 *
 * 直せるのは**名前と、番号としての出しかた**だけ。
 * コード・国・取り込み元は取り込みが決めるもので、画面からは動かさない
 * （動かすと次の取り込みで結び付かなくなる）。
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = inventorySchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  const existing = await prisma.inventory.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  const numberLabel = v.numberLabel?.trim() ? v.numberLabel.trim() : null;
  // 呼び名が無いものを「出す」にしても、見出しの無い番号が並ぶだけ。ここで止める
  if (v.numberShown && !numberLabel) {
    return jsonError(400, "validation_error", m.inventories.labelRequiredToShow);
  }

  await prisma.inventory.update({
    where: { id },
    data: {
      nameJa: v.nameJa?.trim() ? v.nameJa.trim() : null,
      nameEn: v.nameEn?.trim() ? v.nameEn.trim() : null,
      numberLabel,
      numberOrder: v.numberOrder,
      numberShown: v.numberShown,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "inventories",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { numberLabel, numberOrder: v.numberOrder, numberShown: v.numberShown },
  });
  return Response.json({ id });
}
