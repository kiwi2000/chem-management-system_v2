import { formatDate } from "@chem/shared";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { fileResponse, zipFiles } from "@/lib/doc-files";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/documents/batch/[id]/zip — まとめて作った仕事の PDF を 1 つの zip で落とす。
 * **自分が頼んだ仕事だけ。**組成を見られない人には、組成の載った帳票は入れない
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
        where: {
          fileName: { not: null },
          ...(actor.has("COMPOSITION_VIEW") ? {} : { hasComposition: false }),
        },
        orderBy: { generatedAt: "asc" },
        select: { fileName: true, filePath: true },
      },
    },
  });
  if (!job) return jsonError(404, "not_found", m.errors.notFound);

  const files = job.documents.flatMap((d) =>
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
