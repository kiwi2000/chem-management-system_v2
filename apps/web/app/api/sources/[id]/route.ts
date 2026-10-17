import { normalizeCode, sourceSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, STAMP_SELECT, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/sources/[id] */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.source.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = sourceSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  // 楽観的ロックの印。無ければ 400
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;
  const codeNormalized = normalizeCode(v.code);

  if (codeNormalized !== existing.codeNormalized) {
    const clash = await prisma.source.findFirst({ where: { codeNormalized, deletedAt: null } });
    if (clash) return jsonError(409, "duplicate_source_code", m.sources.duplicateCode(v.code));
  }

  // 印が合う行だけを更新する。当たらなければ、ほかの人が先に保存している
  const hit = await prisma.source.updateMany({
    where: { id, ...stampWhere(lock) },
    data: {
      code: v.code,
      codeNormalized,
      note: v.note ?? null,
      color: v.color ?? null,
      mark: v.mark ?? null,
      updatedBy: actor.user.id,
    },
  });
  if (hit.count === 0) {
    return staleFromRow(m, await prisma.source.findUnique({ where: { id }, select: STAMP_SELECT }));
  }

  await writeAudit({
    entity: "sources",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code },
  });
  const after = await prisma.source.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({ ok: true, stamp: rowStamp(after) });
}

/**
 * DELETE /api/sources/[id] — 論理削除。
 * どこかのバージョンで使われているもの、リンクが1件でも来ているものは消せない。
 * 消すと、そのバージョンの判定が黙って変わってしまうため。
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.source.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  const [versions, links] = await Promise.all([
    prisma.linkVersionSource.count({ where: { sourceId: id } }),
    prisma.statutoryCasLink.count({ where: { sourceId: id } }),
  ]);
  if (versions > 0) return jsonError(409, "referenced", m.sources.inUseByVersions(versions));
  if (links > 0) return jsonError(409, "referenced", m.sources.inUseByLinks(links));

  await prisma.source.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedBy: actor.user.id,
      codeNormalized: `${existing.codeNormalized}:${existing.id}`.slice(0, 64),
    },
  });

  await writeAudit({
    entity: "sources",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code },
  });
  return Response.json({ ok: true });
}
