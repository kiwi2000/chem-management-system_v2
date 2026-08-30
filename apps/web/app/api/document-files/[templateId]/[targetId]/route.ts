import {
  EMPTY_DOCUMENT,
  getMessages,
  isLocale,
  organisationIdsIn,
  parseDocumentContent,
} from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { collectFor } from "@/lib/doc-data";
import { fillTemplateFile, inspectTemplateFile, TEMPLATE_EXT } from "@/lib/doc-fill";
import { fileResponse } from "@/lib/doc-fill/response";
import { getServerMessages } from "@/lib/i18n";
import { orgItemLabels } from "@/lib/organisation-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/document-files/[templateId]/[targetId]
 * — Excel・Word の様式に値を埋めて返す。
 *
 * **`/api/documents` の下に置けない。**あちらの1件は発行済みドキュメントの id で、
 * 同じ位置に違う名前の入れ子は作れない（Next.js の決まり）。
 *
 * **作ったファイルは残さない。**画面の様式と同じで、
 * 記録に残すのは「誰がいつ何に対して作ったか」だけ。
 * 同じものが要るときは、もう一度作る
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ templateId: string; targetId: string }> },
) {
  const actor = await requirePermission("DOCUMENT_CREATE");
  if (actor instanceof Response) return actor;
  const { templateId, targetId } = await params;
  const m0 = await getServerMessages();

  const row = await prisma.documentTemplate.findFirst({
    where: { id: templateId, deletedAt: null, active: true },
    select: {
      id: true,
      code: true,
      target: true,
      kind: true,
      locale: true,
      usesRecipient: true,
      content: true,
      fileData: true,
      fileName: true,
    },
  });
  if (!row) return jsonError(404, "not_found", m0.errors.notFound);
  if (row.kind === "BLOCK" || !row.fileData) {
    return jsonError(404, "not_found", m0.errors.notFound);
  }

  // 紙面の言葉は様式に書いてある言語。読んでいる人の画面の言語ではない
  const lower = row.locale.toLowerCase();
  const locale = isLocale(lower) ? lower : "ja";
  const m = getMessages(locale);

  const url = new URL(req.url);
  const parties = {
    senderId: url.searchParams.get("from"),
    // 印の無い様式に付いてきた宛先は捨てる（URLに書けば効く状態を作らない）
    recipientId: row.usesRecipient ? url.searchParams.get("to") : null,
    // 様式が名指ししている組織（組織ブロック）。読めない中身なら名指しなしとみなす
    organisationIds: organisationIdsIn(parseDocumentContent(row.content) ?? EMPTY_DOCUMENT),
  };

  // 見る権限は集める側が判断する。見られない表は、この時点で落ちている
  const data = await collectFor(actor, row.target, targetId, locale, m, parties);
  if (!data) return jsonError(404, "not_found", m0.errors.notFound);

  const file = Buffer.from(row.fileData);
  const orgItems = await orgItemLabels();
  const found = await inspectTemplateFile(file, row.kind, row.target, orgItems);
  const filled = await fillTemplateFile(row.kind, {
    file,
    target: row.target,
    values: data.values,
    tables: data.tables,
    orgItems,
  });

  /*
    組成が載っているか。**札を見て決める。**
    画面の様式はブロックを見れば分かるが、預かったファイルは
    どこに何を書いたかを札でしか知れない
  */
  const hasComposition =
    found.ok &&
    found.tags.some((t) => t.startsWith("{composition.") || t.startsWith("{compositionAggregate."));

  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const name = `${row.code}_${data.code}_${day}${TEMPLATE_EXT[row.kind]}`;

  await Promise.all([
    prisma.generatedDocument.create({
      data: {
        templateId: row.id,
        targetRef: targetId,
        targetCode: data.code,
        generatedBy: actor.user.id,
        /*
          **紙面は残せない。**預かったファイルに埋めた形なので、
          残すならファイルそのものになる。何を出したかだけを控える
        */
        content: { file: { kind: row.kind, name } },
        hasComposition,
        params: {
          version: data.values.get("doc.version") ?? "",
          ...(parties.senderId ? { senderId: parties.senderId } : {}),
          ...(parties.recipientId ? { recipientId: parties.recipientId } : {}),
        },
      },
    }),
    writeAudit({
      entity: "generated_documents",
      entityId: row.id,
      action: "export",
      actorId: actor.user.id,
      diff: { template: row.code, target: data.code, file: name },
    }),
  ]);

  return fileResponse(filled.buffer, name, row.kind);
}
