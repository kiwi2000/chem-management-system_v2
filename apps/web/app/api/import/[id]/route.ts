import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { isRunning } from "@/lib/import/jobs";

const SELECT = {
  id: true,
  kind: true,
  status: true,
  fileName: true,
  fileSize: true,
  summary: true,
  error: true,
  progress: true,
  createdBy: true,
  createdAt: true,
  stagedAt: true,
  appliedAt: true,
  appliedBy: true,
} as const;

/** GET /api/import/[id] — 1 件の状態（進み具合を含む）。画面が数秒おきに聞きに来る */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("DATA_IMPORT");
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  const job = await prisma.importJob.findUnique({ where: { id }, select: SELECT });
  if (!job) {
    const m = await getServerMessages();
    return jsonError(404, "not_found", m.errors.notFound);
  }
  // 種類 × 動きの件数（一時領域の行から数える。要約より新しい）
  const grouped = await prisma.importRow.groupBy({
    by: ["kind", "action", "apply"],
    where: { jobId: id },
    _count: { _all: true },
  });
  return Response.json({
    ...job,
    running: isRunning(id),
    counts: grouped.map((g) => ({
      kind: g.kind,
      action: g.action,
      apply: g.apply,
      count: g._count._all,
    })),
  });
}

/** DELETE /api/import/[id] — 破棄。反映前ならいつでも。一時領域の行とファイルを消し、記録だけ残す */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("DATA_IMPORT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  const { id } = await ctx.params;
  const job = await prisma.importJob.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!job) return jsonError(404, "not_found", m.errors.notFound);
  if (isRunning(id)) return jsonError(409, "running", m.importExport.errors.running);
  if (job.status === "DONE")
    return jsonError(409, "already_applied", m.importExport.errors.alreadyApplied);
  await prisma.$transaction([
    prisma.importRow.deleteMany({ where: { jobId: id } }),
    prisma.importJob.update({ where: { id }, data: { status: "DISCARDED", fileData: null } }),
  ]);
  await writeAudit({
    entity: "import_jobs",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
  });
  return Response.json({ ok: true });
}
