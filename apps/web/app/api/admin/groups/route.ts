import { emptyTableState, groupSchema, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { GROUP_COUNT_SELECT, toGroupDto } from "@/lib/group-service";
import { getServerMessages } from "@/lib/i18n";
import { GROUP_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

/** 既定は 用途 → 表示順。お知らせの見出しの並びと同じ見え方にする */
const DEFAULT_STATE = emptyTableState([
  { column: "kind", direction: "asc" },
  { column: "displayOrder", direction: "asc" },
]);

/** GET /api/admin/groups — グループ管理の一覧（使わないグループも含む） */
export async function GET(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    GROUP_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = buildWhere(GROUP_COLUMNS, state.filters);

  const [items, total] = await Promise.all([
    prisma.group.findMany({
      where: { ...where, deletedAt: null },
      orderBy: buildOrderBy(GROUP_COLUMNS, state.sort, { displayOrder: "asc" }),
      include: GROUP_COUNT_SELECT,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.group.count({ where: { ...where, deletedAt: null } }),
  ]);

  return Response.json({
    items: items.map(toGroupDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/admin/groups — グループの追加 */
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
  const parsed = groupSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  const created = await prisma.group.create({
    data: {
      kind: v.kind,
      nameJa: v.nameJa,
      nameEn: v.nameEn ?? null,
      displayOrder: v.displayOrder,
      activeFlag: v.activeFlag,
    },
  });

  await writeAudit({
    entity: "groups",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { kind: v.kind, nameJa: v.nameJa },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
