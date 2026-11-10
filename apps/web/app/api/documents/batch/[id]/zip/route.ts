import { formatDate } from "@chem/shared";
import { jsonError, requirePermission } from "@/lib/authz";
import { DOC_ACCESS_SELECT, openableDocuments } from "@/lib/doc-access";
import { prisma } from "@/lib/db";
import { fileResponse, zipFiles } from "@/lib/doc-files";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/documents/batch/[id]/zip — まとめて作った仕事の PDF を 1 つの zip で落とす。
 * **自分が頼んだ仕事だけ。**組成を見られない人には、組成の載った帳票は入れない。
 * 自分のぶんなので、作れる人なら落とせる（2026-09-17 指示）
 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("DOCUMENT_CREATE");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const job = await prisma.documentBatchJob.findFirst({
    where: { id, createdBy: actor.user.id },
    select: {
      createdAt: true,
      template: { select: { code: true } },
      documents: {
        where: { fileName: { not: null } },
        orderBy: { generatedAt: "asc" },
        select: { ...DOC_ACCESS_SELECT, id: true, fileName: true, filePath: true },
      },
    },
  });
  if (!job) return jsonError(404, "not_found", m.errors.notFound);

  // 見られない情報を含む帳票は入れない（S31。作った本人でも）
  const openable = await openableDocuments(actor, job.documents);
  const files = job.documents
    .filter((d) => openable.has(d.id))
    .flatMap((d) =>
      d.fileName && d.filePath ? [{ fileName: d.fileName, filePath: d.filePath }] : [],
    );
  const { zip, added, missing } = await zipFiles(files);
  if (added === 0) return jsonError(404, "file_missing", m.documents.downloadNone);

  const res = fileResponse(
    zip,
    `${job.template.code}_${formatDate(job.createdAt, "YYYYMMDD_HHmmss")}.zip`,
    "application/zip",
  );
  res.headers.set("X-Chem-Skipped", String(missing));
  return res;
}
