import { readFile } from "node:fs/promises";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { canAccessDocument } from "@/lib/doc-access";
import { fileExists, fileResponse } from "@/lib/doc-files";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/documents/[id]/file — 作った PDF を落とす。
 *
 * **自分が作ったものだけ。**他人のものは、あることも伝えない。
 * 組成が載っている帳票は、いま組成を見る権限がある人にだけ（画面で開くときと同じ）
 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("DOCUMENT_CREATE");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const row = await prisma.generatedDocument.findUnique({
    where: { id },
    select: {
      generatedBy: true,
      hasComposition: true,
      targetRef: true,
      fileName: true,
      filePath: true,
      template: { select: { target: true } },
    },
  });
  if (!row || !(await canAccessDocument(actor, row))) {
    return jsonError(404, "not_found", m.errors.notFound);
  }
  if (!row.fileName || !(await fileExists(row.filePath))) {
    return jsonError(404, "file_missing", m.documents.fileGone);
  }
  const body = await readFile(row.filePath!);
  return fileResponse(body, row.fileName, "application/pdf");
}
