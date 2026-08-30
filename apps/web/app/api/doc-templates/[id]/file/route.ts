import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { inspectTemplateFile, TEMPLATE_FILE_MAX } from "@/lib/doc-fill";
import { fileResponse } from "@/lib/doc-fill/response";
import { getServerMessages } from "@/lib/i18n";
import { orgItemLabels } from "@/lib/organisation-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 様式に預ける Excel・Word のファイル。
 *
 * **開く前に確かめてから保存する。**中身は zip なので、
 * マクロ付き・大きすぎるもの・別の種類のものは、この入口で断る。
 * 断る理由は画面にそのまま出す（直しかたが分かるように）
 */

/** PUT — ファイルを預ける。本文はファイルそのもの */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("DOC_TEMPLATE_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const row = await prisma.documentTemplate.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, code: true, kind: true, target: true },
  });
  if (!row) return jsonError(404, "not_found", m.errors.notFound);
  if (row.kind === "BLOCK") {
    return jsonError(400, "validation_error", m.docTemplates.file.notFileKind);
  }

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return jsonError(400, "validation_error", m.errors.validation);
  if (buf.length > TEMPLATE_FILE_MAX) {
    return jsonError(400, "validation_error", m.docTemplates.file.rejects.tooLarge);
  }

  const found = await inspectTemplateFile(buf, row.kind, row.target, await orgItemLabels());
  if (!found.ok) {
    return jsonError(400, "validation_error", m.docTemplates.file.rejects[found.reason]);
  }

  /*
    名前は**こちらで削る。**送られたままだと、
    パスや長すぎる名前がそのままダウンロードの名前になる
  */
  const raw = req.headers.get("x-file-name") ?? "";
  const parts = decodeURIComponent(raw)
    .split("/")
    .flatMap((x) => x.split("\\"));
  const name = parts.pop()?.slice(0, 255) || `${row.code}`;

  await prisma.documentTemplate.update({
    where: { id },
    data: {
      fileData: buf,
      fileName: name,
      fileUpdatedAt: new Date(),
      updatedBy: actor.user.id,
    },
  });
  await writeAudit({
    entity: "document_templates",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { file: name, bytes: buf.length },
  });
  return Response.json({ ok: true, fileName: name, tags: found.tags, unknown: found.unknown });
}

/** GET — 預けたファイルをそのまま返す。直すときに落として使う */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("DOCUMENT_CREATE");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const row = await prisma.documentTemplate.findFirst({
    where: { id, deletedAt: null },
    select: { kind: true, fileData: true, fileName: true },
  });
  if (!row?.fileData || row.kind === "BLOCK") {
    return jsonError(404, "not_found", m.errors.notFound);
  }
  return fileResponse(Buffer.from(row.fileData), row.fileName ?? "template", row.kind);
}

/** DELETE — 預けたファイルを外す */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("DOC_TEMPLATE_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  await prisma.documentTemplate.update({
    where: { id },
    data: { fileData: null, fileName: null, fileUpdatedAt: null, updatedBy: actor.user.id },
  });
  return Response.json({ ok: true });
}
