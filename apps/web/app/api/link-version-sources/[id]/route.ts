import { linkVersionSourceSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { recomputeAllScores } from "@/lib/score-store";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/link-version-sources/[id] — 説明の書き換え。
 * バージョンと種別は組み替えない（付いているリンクの持ち主が変わってしまうため）。
 * 変えたいときは、消してから登録し直す。
 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.linkVersionSource.findUnique({ where: { id } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = linkVersionSourceSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  if (v.versionId !== existing.versionId || v.sourceId !== existing.sourceId) {
    return jsonError(409, "immutable", m.dataSources.cannotMove);
  }

  const enabledChanged = v.enabled !== undefined && v.enabled !== existing.enabled;
  await prisma.linkVersionSource.update({
    where: { id },
    data: {
      note: v.note ?? null,
      ...(v.enabled === undefined ? {} : { enabled: v.enabled }),
      updatedBy: actor.user.id,
    },
  });
  /*
    有効／無効を切り替えると、そのデータソースのリンクが点に入ったり外れたりする。
    取り込みのときと同じく、物質のスコアはここで計算し直す。
    判定は管理者が「全製品を判定し直す」を押す（更新日時が変わるので「要再計算」の印が出る）
  */
  if (enabledChanged) {
    await recomputeAllScores().catch((e) => console.error("score recompute failed:", e));
  }

  await writeAudit({
    entity: "link_version_sources",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: {
      note: v.note ?? null,
      ...(enabledChanged ? { enabled: { from: existing.enabled, to: v.enabled } } : {}),
    },
  });
  return Response.json({ ok: true });
}

/**
 * DELETE /api/link-version-sources/[id] — 削除。
 * リンクが入っているものは消せない。先に中身を消してもらう
 * （黙って一緒に消すと、判定の結果が理由もなく変わるため）。
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.linkVersionSource.findUnique({
    where: { id },
    include: {
      version: { select: { code: true } },
      source: { select: { code: true, color: true, mark: true } },
    },
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  const links = await prisma.statutoryCasLink.count({
    where: { versionId: existing.versionId, sourceId: existing.sourceId },
  });
  if (links > 0) return jsonError(409, "referenced", m.dataSources.inUseByLinks(links));

  await prisma.linkVersionSource.delete({ where: { id } });

  await writeAudit({
    entity: "link_version_sources",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { version: existing.version.code, source: existing.source.code },
  });
  return Response.json({ ok: true });
}
