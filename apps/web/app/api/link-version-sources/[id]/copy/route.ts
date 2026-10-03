import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { copyCandidates, copySourceContents } from "@/lib/link-copy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/link-version-sources/[id]/copy — 別の版から、同じデータソースの中身を写す（2026-10-04）。
 * body: `{ fromVersionId }`。この版 × このデータソースの中身は入れ替え（前の中身は消える）。
 * 写し元は同じデータソースを持つほかの版だけ（copy-candidates に出るもの）
 */
export async function POST(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const target = await prisma.linkVersionSource.findUnique({
    where: { id },
    include: { version: { select: { code: true } }, source: { select: { code: true } } },
  });
  if (!target) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const fromVersionId = (body as { fromVersionId?: unknown })?.fromVersionId;
  if (typeof fromVersionId !== "string") {
    return jsonError(400, "validation_error", m.errors.validation);
  }
  const candidates = await copyCandidates(target.versionId, target.sourceId);
  const from = candidates.find((c) => c.versionId === fromVersionId);
  if (!from) return jsonError(400, "validation_error", m.dataSources.copyNoSource);

  const result = await copySourceContents({
    fromVersionId,
    toVersionId: target.versionId,
    sourceId: target.sourceId,
    actorId: actor.user.id,
  });
  await writeAudit({
    entity: "link_version_sources",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: {
      copiedFrom: from.versionCode,
      version: target.version.code,
      source: target.source.code,
      ...result,
    },
  });
  return Response.json({ ok: true, ...result, from: from.versionCode });
}
