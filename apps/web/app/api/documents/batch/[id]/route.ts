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
