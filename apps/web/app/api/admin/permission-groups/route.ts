import {
  applyFilters,
  emptyTableState,
  parseTableState,
  PERMISSION_GROUP_SELF,
  permissionGroupSchema,
  type ColumnKind,
} from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import {
  groupCode,
  listPermissionGroups,
  normalizeGroupPermissions,
  normalizeRows,
  replaceRowsAndPermissions,
} from "@/lib/permission-group-service";
import type { PermissionGroupListItemDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 一覧の列。画面（app/admin/permission-groups/page.tsx）とキーをそろえる */
const COLUMNS: { key: string; kind: ColumnKind }[] = [
  { key: "code", kind: "text" },
  { key: "nameJa", kind: "text" },
  { key: "memberCount", kind: "number" },
  { key: "productCount", kind: "number" },
  { key: "substanceCount", kind: "number" },
  { key: "targets", kind: "text" },
];
const DEFAULT_STATE = emptyTableState([{ column: "code", direction: "asc" }]);

function cellOf(g: PermissionGroupListItemDto, key: string): string {
  switch (key) {
    case "code":
      return g.code;
    case "nameJa":
      return g.nameJa;
    case "memberCount":
      return String(g.memberCount);
    case "productCount":
      return String(g.productCount);
    case "substanceCount":
      return String(g.substanceCount);
    case "targets":
      return g.targets.map((t) => `${t.code} ${t.nameJa}`).join(" ");
    default:
      return "";
  }
}

/**
 * GET /api/admin/permission-groups — 管理グループの一覧（S31 画面設計 2 章）。
 * 多くても数十なので、全部読んでから絞り込み・並べ替えをする。システム管理グループはいつも先頭
 */
export async function GET(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const state = parseTableState(new URL(req.url).searchParams, COLUMNS, DEFAULT_STATE);
  const all = await listPermissionGroups();
  const filtered = applyFilters(all, state.filters, cellOf);
  const numeric = new Set(["memberCount", "productCount", "substanceCount"]);
  const sorted = [...filtered].sort((a, b) => {
    if (a.isSystemAdmin !== b.isSystemAdmin) return a.isSystemAdmin ? -1 : 1;
    for (const r of state.sort) {
      const x = cellOf(a, r.column);
      const y = cellOf(b, r.column);
      const c = numeric.has(r.column) ? Number(x) - Number(y) : x.localeCompare(y, "ja");
      if (c !== 0) return r.direction === "asc" ? c : -c;
    }
    return a.code.localeCompare(b.code);
  });
  const start = (state.page - 1) * state.pageSize;
  return Response.json({
    items: sorted.slice(start, start + state.pageSize),
    total: sorted.length,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/admin/permission-groups — 管理グループを作る（表・別の権限も一緒に） */
export async function POST(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = permissionGroupSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const input = parsed.data;
  const code = groupCode(input.code);
  if (await prisma.permissionGroup.findUnique({ where: { code }, select: { id: true } })) {
    return jsonError(409, "duplicate_code", m.permGroups.duplicateCode, {
      fieldErrors: { code: [m.permGroups.duplicateCode] },
    });
  }
  const permissions = normalizeGroupPermissions(input.permissions);
  const created = await prisma.permissionGroup.create({
    data: {
      code,
      nameJa: input.nameJa,
      nameEn: input.nameEn ?? null,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
    },
    select: { id: true },
  });
  // 自分の行を指すものは、作ったばかりの id に差し替える（画面は「自分」を仮の id で送る）
  const rows = await normalizeRows(
    input.rows.map((r) => ({
      ...r,
      targetGroupId: r.targetGroupId === PERMISSION_GROUP_SELF ? created.id : r.targetGroupId,
    })),
  );
  await prisma.$transaction(replaceRowsAndPermissions(created.id, rows, permissions));
  await writeAudit({
    entity: "permission_groups",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code, nameJa: input.nameJa, rows: rows.length, permissions },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
