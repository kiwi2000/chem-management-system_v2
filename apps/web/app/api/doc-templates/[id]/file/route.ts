import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { inspectTemplateFile, TEMPLATE_FILE_MAX } from "@/lib/doc-fill";
import { fileResponse } from "@/lib/doc-fill/response";
import { STAMP_SELECT, parseEditStamp, rowStamp, staleFromRow, stampWhere } from "@/lib/edit-stamp";
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
  /*
    ほかの人が先に保存していないか（楽観的ロック。lib/edit-stamp.ts）。
    本文はファイルそのものなので、印は URL の `?stamp=`・`?force=1` で受ける（S29 §4-4）
  */
  const query = new URL(req.url).searchParams;
  const lock = parseEditStamp(
    { stamp: query.get("stamp") ?? undefined, force: query.get("force") === "1" },
    m,
  );
  if (lock instanceof Response) return lock;

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

  // 印が合う行だけを直す。当たらなければ、ほかの人が先に保存している
  const hit = await prisma.documentTemplate.updateMany({
    where: { id, ...stampWhere(lock) },
    data: {
      fileData: buf,
      fileName: name,
      fileUpdatedAt: new Date(),
      updatedBy: actor.user.id,
    },
  });
  if (hit.count === 0) {
    return staleFromRow(
      m,
      await prisma.documentTemplate.findUnique({ where: { id }, select: STAMP_SELECT }),
    );
  }
  await writeAudit({
    entity: "document_templates",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { file: name, bytes: buf.length },
  });
  // 保存後の印。続けて直せるように返す
  const after = await prisma.documentTemplate.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({
    ok: true,
    fileName: name,
    tags: found.tags,
    unknown: found.unknown,
    stamp: rowStamp(after),
  });
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
