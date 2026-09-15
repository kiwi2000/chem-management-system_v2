import { docBatchRequestSchema } from "@chem/shared";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  JOB_SELECT,
  countRunningFor,
  enqueueDocBatch,
  markInterrupted,
  resolveTargetIds,
  toJobDto,
} from "@/lib/doc-batch-job";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** 一覧に出す仕事の数。古いものは「自分が作ったドキュメント」で見る */
const RECENT = 20;

/**
 * GET /api/documents/batch — 自分が頼んだ、まとめて作る仕事（新しい順に 20 件）。
 * サーバーの再起動で途切れた仕事があれば、ここで「中断」の印を付けてから返す
 */
export async function GET() {
  const actor = await requirePermission("DOCUMENT_CREATE");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  await markInterrupted(actor.user.id, m.documents.jobInterrupted);
  const [rows, running] = await Promise.all([
    prisma.documentBatchJob.findMany({
      where: { createdBy: actor.user.id },
      orderBy: { createdAt: "desc" },
      take: RECENT,
      select: JOB_SELECT,
    }),
    countRunningFor(actor.user.id),
  ]);
  return Response.json({ items: rows.map(toJobDto), running });
}

/**
 * POST /api/documents/batch — まとめて作る仕事を頼む。
 *
 * 相手は ID の並びか、一覧の絞り込みの条件。件数だけ先に数えて返し、作るのは裏で進める。
 * **Excel・Word の様式はまとめて作れない**（ファイルを置く場所が無い。保留。2026-09-16）
 */
export async function POST(req: Request) {
  const actor = await requirePermission("DOCUMENT_CREATE");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = docBatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  const template = await prisma.documentTemplate.findFirst({
    where: { id: v.templateId, deletedAt: null, active: true },
    select: { id: true, kind: true, target: true },
  });
  if (!template) return jsonError(404, "not_found", m.errors.notFound);
  if (template.kind !== "BLOCK") return jsonError(400, "file_template", m.documents.fileBatch);

  // 件数は頼んだ時点のもの。走るときにもう一度引き直す（そのあいだに増減していれば、そちらに従う）
  const ids = await resolveTargetIds(actor, template.target, v.selection);
  if (ids.length === 0) return jsonError(400, "empty", m.documents.batchEmpty);

  const job = await prisma.documentBatchJob.create({
    data: {
      templateId: template.id,
      selection: v.selection,
      params: {
        ...(v.company ? { company: v.company } : {}),
        ...(v.department ? { department: v.department } : {}),
        ...(v.to ? { to: v.to } : {}),
        ...(v.org && v.org.length > 0 ? { org: v.org } : {}),
      },
      total: ids.length,
      createdBy: actor.user.id,
    },
    select: { id: true },
  });
  enqueueDocBatch(job.id);
  return Response.json({ id: job.id, total: ids.length }, { status: 201 });
}
