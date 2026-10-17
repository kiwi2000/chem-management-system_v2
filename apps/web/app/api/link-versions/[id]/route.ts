import { linkSetVersionSchema, normalizeCode } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, STAMP_SELECT, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { asOfDate, ensureCurrentVersion } from "@/lib/link-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/link-versions/[id] — 名前と備考。現在のバージョンの切り替えは別の口で行う */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.linkSetVersion.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = linkSetVersionSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);
  // ほかの人が先に保存していないか（楽観的ロック）
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;

  if (codeNormalized !== existing.codeNormalized) {
    const clash = await prisma.linkSetVersion.findFirst({
      where: { codeNormalized, deletedAt: null },
    });
    if (clash)
      return jsonError(409, "duplicate_version_code", m.linkVersions.duplicateCode(v.code));
  }

  const hit = await prisma.linkSetVersion.updateMany({
    where: { id, ...stampWhere(lock) },
    data: {
      code: v.code,
      codeNormalized,
      ...(v.asOf !== undefined ? { asOf: asOfDate(v.asOf) } : {}),
      updatedBy: actor.user.id,
    },
  });
  if (hit.count === 0) {
    return staleFromRow(
      m,
      await prisma.linkSetVersion.findUnique({ where: { id }, select: STAMP_SELECT }),
    );
  }

  await ensureCurrentVersion(actor.user.id);

  await writeAudit({
    entity: "link_set_versions",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code },
  });
  // 現在の版の付け替えでこの行がもう一度動くことがあるので、印はその後に引く
  const after = await prisma.linkSetVersion.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({ ok: true, stamp: rowStamp(after) });
}

/**
 * DELETE /api/link-versions/[id] — 論理削除。
 * 現在のバージョンは消せない。判定に使うバージョンが無くなってしまうため。
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.linkSetVersion.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);
  if (existing.isCurrent) return jsonError(409, "referenced", m.linkVersions.cannotDeleteCurrent);

  await prisma.linkSetVersion.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedBy: actor.user.id,
      codeNormalized: `${existing.codeNormalized}:${existing.id}`.slice(0, 64),
    },
  });

  await ensureCurrentVersion(actor.user.id);

  await writeAudit({
    entity: "link_set_versions",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code },
  });
  return Response.json({ ok: true });
}
