import { z } from "zod";
import { formatDate } from "@chem/shared";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { documentWhere } from "@/lib/doc-access";
import { fileResponse, zipFiles } from "@/lib/doc-files";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ ids: z.array(z.string().trim().min(1)).min(1).max(1000) });

/**
 * POST /api/documents/download — 選んだ帳票の PDF を 1 つの zip にして落とす。
 *
 * **見せてよいものだけ**を入れる（lib/doc-access.ts。他人のものは権限があるときだけ）。
 * ファイルが無くなっているものも外し、外した数は応答のヘッダーで知らせる
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
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }

  const rows = await prisma.generatedDocument.findMany({
    where: {
      id: { in: parsed.data.ids },
      ...(await documentWhere(actor)),
      fileName: { not: null },
    },
    orderBy: { generatedAt: "asc" },
    select: { fileName: true, filePath: true },
  });
  const files = rows.flatMap((r) =>
    r.fileName && r.filePath ? [{ fileName: r.fileName, filePath: r.filePath }] : [],
  );
  const { zip, added, missing } = await zipFiles(files);
  if (added === 0) return jsonError(404, "file_missing", m.documents.downloadNone);

  const res = fileResponse(
    zip,
    `documents_${formatDate(new Date(), "YYYYMMDD_HHmmss")}.zip`,
    "application/zip",
  );
  res.headers.set("X-Chem-Skipped", String(missing + (parsed.data.ids.length - rows.length)));
  return res;
}
