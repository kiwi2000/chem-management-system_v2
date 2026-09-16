import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { JOB_SELECT, toJobDto } from "@/lib/doc-batch-job";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/documents/batch/[id] — まとめて作る仕事 1 件の進み具合。
 * **自分が頼んだものだけ。**他人のものは、あることも伝えない
 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("DOCUMENT_CREATE");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const row = await prisma.documentBatchJob.findFirst({
    where: { id, createdBy: actor.user.id },
    select: JOB_SELECT,
  });
  if (!row) return jsonError(404, "not_found", m.errors.notFound);
  return Response.json(toJobDto(row));
}

/**
 * DELETE /api/documents/batch/[id] — 生成状況から 1 件消す。
 * **自分が頼んだものだけ。走っている最中は消せない。**
 * 消えるのは仕事の記録だけで、できた帳票（PDF）は生成済ドキュメントに残る
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("DOCUMENT_CREATE");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const row = await prisma.documentBatchJob.findFirst({
    where: { id, createdBy: actor.user.id },
    select: { status: true },
  });
  if (!row) return jsonError(404, "not_found", m.errors.notFound);
  if (row.status === "QUEUED" || row.status === "RUNNING") {
    return jsonError(409, "running", m.documents.jobDeleteRunning);
  }
  await prisma.documentBatchJob.delete({ where: { id } });
  return Response.json({ ok: true });
}
