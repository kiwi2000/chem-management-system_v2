import { emptyTableState, parseTableState } from "@chem/shared";
import type { ImportKind } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { inspectFile } from "@/lib/import/stage";
import { buildOrderBy, buildWhere, type QueryColumn } from "@/lib/table-query";

export const dynamic = "force-dynamic";

/** 受け付けるファイルの上限。当方のデータセット（LOLI の版を圧縮したもの）が入る大きさ */
const IMPORT_FILE_MAX = 200 * 1024 * 1024;

/** 履歴の列。画面（components/import-screen.tsx）とキーをそろえる */
const COLUMNS: QueryColumn[] = [
  { key: "fileName", kind: "text", field: "fileName", caseInsensitive: true },
  { key: "kind", kind: "enum", field: "kind" },
  { key: "status", kind: "enum", field: "status" },
  { key: "createdAt", kind: "date", field: "createdAt" },
  { key: "appliedAt", kind: "date", field: "appliedAt" },
];
const DEFAULT_STATE = emptyTableState([{ column: "createdAt", direction: "desc" }]);

/**
 * GET /api/import — 取り込みの履歴（新しい順）。ファイルの中身は返さない
 */
export async function GET(req: Request) {
  const actor = await requirePermission("DATA_IMPORT");
  if (actor instanceof Response) return actor;
  const state = parseTableState(
    new URL(req.url).searchParams,
    COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = buildWhere(COLUMNS, state.filters);
  const [jobs, total] = await Promise.all([
    prisma.importJob.findMany({
      where,
      orderBy: buildOrderBy(COLUMNS, state.sort, { createdAt: "desc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
      select: {
        id: true,
        kind: true,
        status: true,
        fileName: true,
        fileSize: true,
        summary: true,
        error: true,
        progress: true,
        createdBy: true,
        createdAt: true,
        stagedAt: true,
        appliedAt: true,
        appliedBy: true,
      },
    }),
    prisma.importJob.count({ where }),
  ]);
  const users = await prisma.user.findMany({
    where: {
      id: {
        in: [
          ...new Set(
            jobs.flatMap((j) => [j.createdBy, j.appliedBy]).filter((v): v is string => !!v),
          ),
        ],
      },
    },
    select: { id: true, displayName: true, email: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.displayName || u.email]));
  return Response.json({
    items: jobs.map((j) => ({
      ...j,
      createdByName: nameOf.get(j.createdBy) ?? j.createdBy,
      appliedByName: j.appliedBy ? (nameOf.get(j.appliedBy) ?? j.appliedBy) : null,
    })),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/**
 * POST /api/import — ファイルを受け取り、種類と行数を返す（決定 0011 §4）。
 * まだ本体にも一時領域にも書かない。次に「インポート」で読み取り（/stage）、確認して「反映」（/apply）
 */
export async function POST(req: Request) {
  const actor = await requirePermission("DATA_IMPORT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "invalid_form", m.errors.validation);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "no_file", m.importExport.errors.noFile);
  if (file.size > IMPORT_FILE_MAX)
    return jsonError(413, "too_large", m.importExport.errors.tooLarge);
  const bytes = Buffer.from(await file.arrayBuffer());
  const inspected = await inspectFile(file.name, bytes);
  if (!inspected.ok) {
    const reasons = m.importExport.errors;
    const message =
      inspected.reason === "missing_columns"
        ? reasons.missingColumns(inspected.missing ?? [])
        : inspected.reason === "extension"
          ? reasons.extension
          : inspected.reason === "not_data_set"
            ? reasons.notDataSet
            : inspected.reason === "empty"
              ? reasons.empty
              : inspected.reason === "zip_empty"
                ? reasons.zipEmpty
                : reasons.unreadable;
    return jsonError(400, "unrecognized", message, {
      reason: inspected.reason,
      missing: inspected.missing,
    });
  }
  const job = await prisma.importJob.create({
    data: {
      kind: inspected.kind as ImportKind,
      fileName: file.name.slice(0, 255),
      fileSize: file.size,
      fileData: bytes,
      createdBy: actor.user.id,
      summary: {
        kind: inspected.kind,
        fileName: file.name,
        rows: inspected.rowCount ?? null,
        header: inspected.header ?? null,
      } as object,
    },
    select: { id: true, kind: true, fileName: true, fileSize: true, status: true, summary: true },
  });
  await writeAudit({
    entity: "import_jobs",
    entityId: job.id,
    action: "create",
    actorId: actor.user.id,
    diff: { kind: job.kind, fileName: job.fileName, size: job.fileSize },
  });
  return Response.json(job, { status: 201 });
}
