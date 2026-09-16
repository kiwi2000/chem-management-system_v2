import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { canAccessDocument } from "@/lib/doc-access";
import { removeFile } from "@/lib/doc-files";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/documents/[id] — 発行済みのドキュメントを消す。
 *
 * **消せるのは自分が作ったものだけ。**他人のものは、あることも伝えない。
 *
 * **印だけ付けるのではなく、本当に消す。**発行済みの紙面には組成が
 * 載っていることがあり、残したままにすると「消したはずのものが残っている」
 * という状態を作ってしまう。消した記録は監査ログに残す。
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("DOCUMENT_CREATE");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const row = await prisma.generatedDocument.findUnique({
    where: { id },
    select: {
      generatedBy: true,
      targetCode: true,
      targetRef: true,
      hasComposition: true,
      generatedAt: true,
      filePath: true,
      template: { select: { code: true, target: true } },
    },
  });
  // 自分のものか、権限があれば他人のものも（lib/doc-access.ts）。見せないものは、あることも伝えない
  if (!row || !(await canAccessDocument(actor, row))) {
    return jsonError(404, "not_found", m.errors.notFound);
  }

  await prisma.generatedDocument.delete({ where: { id } });
  // PDF のファイルも一緒に消す（記録だけ消えて、ファイルが残らないように）
  await removeFile(row.filePath);
  await writeAudit({
    entity: "generated_documents",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: {
      template: row.template.code,
      target: row.targetCode,
      generatedAt: row.generatedAt.toISOString(),
    },
  });
  return Response.json({ ok: true });
}
