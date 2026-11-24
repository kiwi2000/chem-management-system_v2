import { inventoryRowSchema, normalizeCas } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, STAMP_SELECT, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { currentVersion } from "@/lib/inventory-service";
import { guardUnique } from "@/lib/unique-violation";

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
  // ほかの人が先に保存していないか（楽観的ロック）
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;

  const { version, row } = await targetRow(req, id, rowId);
  if (!version) return jsonError(409, "no_current_version", m.inventories.noCurrentVersion);
  if (!row) return jsonError(404, "not_found", m.errors.notFound);

  const casNormalized = normalizeCas(v.casNumber);
  const clash = async () => {
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
    return dup ? jsonError(409, "duplicate_row", m.inventories.duplicateRow) : null;
  };
  const clashed = await clash();
  if (clashed) return clashed;

  // 同じ行へほぼ同時に直されたら、一意の決まりで止まる。そのときもいつもの文で返す
  const hit = await guardUnique(m, clash, () =>
    prisma.inventoryRow.updateMany({
      where: { id: rowId, ...stampWhere(lock) },
      data: {
        sourceId: v.sourceId,
        casNumber: v.casNumber,
        casNormalized,
        value: v.value,
        updatedBy: actor.user.id,
      },
    }),
  );
  if (hit instanceof Response) return hit;
  if (hit.count === 0) {
    return staleFromRow(
      m,
      await prisma.inventoryRow.findUnique({ where: { id: rowId }, select: STAMP_SELECT }),
    );
  }

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
  const after = await prisma.inventoryRow.findUniqueOrThrow({
    where: { id: rowId },
    select: { updatedAt: true },
  });
  return Response.json({ id: rowId, stamp: rowStamp(after) });
}
