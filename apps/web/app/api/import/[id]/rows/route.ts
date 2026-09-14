import { emptyTableState, parseTableState } from "@chem/shared";
import type { ImportAction } from "@prisma/client";
import { z } from "zod";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { isRunning } from "@/lib/import/jobs";
import { buildOrderBy, buildWhere, type QueryColumn } from "@/lib/table-query";

/** 一時領域の一覧の列。画面の列（components/import-rows-table.tsx）とキーをそろえる */
const COLUMNS: QueryColumn[] = [
  { key: "seq", kind: "number", field: "seq" },
  { key: "kind", kind: "enum", field: "kind" },
  { key: "action", kind: "enum", field: "action" },
  { key: "keyPath", kind: "text", field: "keyPath" },
  { key: "label", kind: "text", field: "label" },
  { key: "message", kind: "text", field: "message" },
];
const DEFAULT_STATE = emptyTableState([{ column: "seq", direction: "asc" }]);

/** GET /api/import/[id]/rows — 一時領域の行（絞り込み・並べ替え・ページ） */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("DATA_IMPORT");
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  const params = new URL(req.url).searchParams;
  const state = parseTableState(
    params,
    COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  // 既定では「変更なし」を隠す（件数が多く、見ても仕方がない）。showUnchanged=1 で出す
  const showUnchanged = params.get("showUnchanged") === "1";
  const where = {
    AND: [
      { jobId: id },
      showUnchanged ? {} : { action: { not: "UNCHANGED" as ImportAction } },
      buildWhere(COLUMNS, state.filters),
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.importRow.findMany({
      where,
      orderBy: buildOrderBy(COLUMNS, state.sort, { seq: "asc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
      select: {
        id: true,
        seq: true,
        kind: true,
        keyPath: true,
        label: true,
        action: true,
        apply: true,
        diff: true,
        message: true,
      },
    }),
    prisma.importRow.count({ where }),
  ]);
  return Response.json({ items: rows, total, page: state.page, pageSize: state.pageSize });
}

const patchSchema = z.object({
  apply: z.boolean(),
  /** 行の id で指定 */
  ids: z.array(z.string()).max(5000).optional(),
  /** まとめて（種類と動きで絞る）。ids と一緒には使わない */
  all: z
    .object({
      kind: z.string().optional(),
      action: z.enum(["ADD", "UPDATE", "CONFLICT"]).optional(),
    })
    .optional(),
});

/** PATCH /api/import/[id]/rows — 「反映する」の印を付け外しする。反映前だけ */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("DATA_IMPORT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  const { id } = await ctx.params;
  const job = await prisma.importJob.findUnique({ where: { id }, select: { status: true } });
  if (!job) return jsonError(404, "not_found", m.errors.notFound);
  if (job.status !== "STAGED" || isRunning(id))
    return jsonError(409, "bad_status", m.importExport.errors.badStatus);
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  const { apply, ids, all } = parsed.data;
  // ERROR と UNCHANGED は反映できない（印を付けても意味が無い）
  const base = { jobId: id, action: { in: ["ADD", "UPDATE", "CONFLICT"] as ImportAction[] } };
  const where = ids
    ? { ...base, id: { in: ids } }
    : {
        ...base,
        ...(all?.kind ? { kind: all.kind } : {}),
        ...(all?.action ? { action: all.action } : {}),
      };
  const r = await prisma.importRow.updateMany({ where, data: { apply } });
  return Response.json({ updated: r.count });
}
