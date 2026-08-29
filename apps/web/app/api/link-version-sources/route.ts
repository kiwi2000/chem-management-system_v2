import { linkVersionSourceSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { toLinkVersionSourceDto } from "@/lib/link-service";

export const dynamic = "force-dynamic";

/** 画面に出すのに要るぶんだけ一緒に引く */
const INCLUDE = {
  version: { select: { code: true } },
  source: { select: { code: true, color: true, mark: true } },
} as const;

/**
 * GET /api/link-version-sources — 一覧。
 * バージョンで絞れる（?versionId=...）。件数が知れているので、まとめて返す。
 */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;

  const versionId = new URL(req.url).searchParams.get("versionId");
  const items = await prisma.linkVersionSource.findMany({
    where: versionId ? { versionId } : {},
    // 優先度の順。バージョンをまたぐときはバージョンでまとめる
    orderBy: [{ version: { code: "desc" } }, { priority: "asc" }],
    include: INCLUDE,
  });

  // リンクの数は「バージョン＋種別」で数える。組ごとに1回の集計で足りる
  const counts = await prisma.statutoryCasLink.groupBy({
    by: ["versionId", "sourceId"],
    _count: { _all: true },
  });
  const countOf = new Map(counts.map((c) => [`${c.versionId}/${c.sourceId}`, c._count._all]));

  return Response.json({
    items: items.map((r) =>
      toLinkVersionSourceDto(r, countOf.get(`${r.versionId}/${r.sourceId}`) ?? 0),
    ),
    total: items.length,
    page: 1,
    pageSize: items.length,
  });
}

/**
 * POST /api/link-version-sources — 追加。
 * 優先度は末尾に付ける。並びはあとから上下に動かして決める。
 */
export async function POST(req: Request) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

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

  const [version, source] = await Promise.all([
    prisma.linkSetVersion.findFirst({ where: { id: v.versionId, deletedAt: null } }),
    prisma.source.findFirst({ where: { id: v.sourceId, deletedAt: null } }),
  ]);
  if (!version || !source) return jsonError(404, "not_found", m.errors.notFound);

  const dup = await prisma.linkVersionSource.findFirst({
    where: { versionId: v.versionId, sourceId: v.sourceId },
  });
  if (dup) return jsonError(409, "duplicate", m.dataSources.duplicate);

  const last = await prisma.linkVersionSource.findFirst({
    where: { versionId: v.versionId },
    orderBy: { priority: "desc" },
    select: { priority: true },
  });

  const created = await prisma.linkVersionSource.create({
    data: {
      versionId: v.versionId,
      sourceId: v.sourceId,
      note: v.note ?? null,
      priority: (last?.priority ?? 0) + 1,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "link_version_sources",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { version: version.code, source: source.code },
  });
  return Response.json({ id: created.id, warnings: [] }, { status: 201 });
}
