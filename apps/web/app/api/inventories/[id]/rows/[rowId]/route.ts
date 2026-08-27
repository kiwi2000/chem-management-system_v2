import { inventoryRowSchema, normalizeCas } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { currentVersion } from "@/lib/inventory-service";

export const dynamic = "force-dynamic";

/**
 * 直す先は**画面で選んでいるバージョン**。省かれたときは現在のバージョン。
 * その行が本当にそのバージョンのものかを、ここで必ず確かめる
 * （URL を書き換えて他のバージョンの行を触られないようにするため）。
 */
async function targetRow(req: Request, id: string, rowId: string) {
  const asked = new URL(req.url).searchParams.get("versionId");
  const version = asked
    ? await prisma.linkSetVersion.findFirst({
        where: { id: asked, deletedAt: null },
        select: { id: true, code: true },
      })
    : await currentVersion();
  if (!version) return { version: null, row: null };
  const row = await prisma.inventoryRow.findFirst({
    where: { id: rowId, inventoryId: id, versionId: version.id },
    select: { id: true, sourceId: true, casNumber: true, value: true },
  });
  return { version, row };
}

/** PUT /api/inventories/[id]/rows/[rowId] — 行を直す */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string; rowId: string }> }) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  const { id, rowId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = inventoryRowSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  const { version, row } = await targetRow(req, id, rowId);
  if (!version) return jsonError(409, "no_current_version", m.inventories.noCurrentVersion);
  if (!row) return jsonError(404, "not_found", m.errors.notFound);

  const casNormalized = normalizeCas(v.casNumber);
  const dup = await prisma.inventoryRow.findFirst({
    where: {
      versionId: version.id,
      sourceId: v.sourceId,
      inventoryId: id,
      casNormalized,
      value: v.value,
      id: { not: rowId },
    },
    select: { id: true },
  });
  if (dup) return jsonError(409, "duplicate_row", m.inventories.duplicateRow);

  await prisma.inventoryRow.update({
    where: { id: rowId },
    data: {
      sourceId: v.sourceId,
      casNumber: v.casNumber,
      casNormalized,
      value: v.value,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "inventory_rows",
    entityId: rowId,
    action: "update",
    actorId: actor.user.id,
    diff: {
      before: { sourceId: row.sourceId, casNumber: row.casNumber, value: row.value },
      after: { sourceId: v.sourceId, casNumber: v.casNumber, value: v.value },
    },
  });
  return Response.json({ id: rowId });
}

/**
 * DELETE /api/inventories/[id]/rows/[rowId] — 行を消す。
 *
 * **本当に消す。**インベントリの行は論理削除を持たない。
 * 「載っていない」ことに意味がある表なので、消したものが残っていると
 * 「載っているが無効」なのか「載っていない」のかが区別できなくなる。
 * 消した跡はアクセス記録に残る
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; rowId: string }> },
) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  const { id, rowId } = await ctx.params;

  const { version, row } = await targetRow(req, id, rowId);
  if (!version) return jsonError(409, "no_current_version", m.inventories.noCurrentVersion);
  if (!row) return jsonError(404, "not_found", m.errors.notFound);

  await prisma.inventoryRow.delete({ where: { id: rowId } });
  await writeAudit({
    entity: "inventory_rows",
    entityId: rowId,
    action: "delete",
    actorId: actor.user.id,
    diff: {
      inventoryId: id,
      sourceId: row.sourceId,
      casNumber: row.casNumber,
      value: row.value,
    },
  });
  return new Response(null, { status: 204 });
}
