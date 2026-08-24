import {
  emptyTableState,
  linkSetVersionSchema,
  normalizeCode,
  parseTableState,
} from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { ensureCurrentVersion, toLinkSetVersionDto } from "@/lib/link-service";
import { LINK_VERSION_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

/** 版コードの新しい順（年度が下がっていく形になる） */
const DEFAULT_STATE = emptyTableState([{ column: "code", direction: "desc" }]);

/** GET /api/link-versions — 一覧 */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    LINK_VERSION_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = { deletedAt: null, ...buildWhere(LINK_VERSION_COLUMNS, state.filters) };

  const [items, total] = await Promise.all([
    prisma.linkSetVersion.findMany({
      where,
      // 現在版を先頭に寄せたりはしない。切り替えるたびに行が動くと、
      // どれを押したのか分からなくなるため（印だけが移る）
      orderBy: buildOrderBy(LINK_VERSION_COLUMNS, state.sort, { code: "desc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.linkSetVersion.count({ where }),
  ]);

  return Response.json({
    items: items.map(toLinkSetVersionDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/link-versions — 追加。中身は空で作る（取込で入れる） */
export async function POST(req: Request) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = linkSetVersionSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  const live = await prisma.linkSetVersion.findFirst({
    where: { codeNormalized, deletedAt: null },
  });
  if (live) return jsonError(409, "duplicate_version_code", m.linkVersions.duplicateCode(v.code));

  const created = await prisma.linkSetVersion.create({
    data: { code: v.code, codeNormalized, createdBy: actor.user.id, updatedBy: actor.user.id },
  });

  // 1件目なら自動で現在になる。指定が無ければ、より新しいコードのものへ移る
  await ensureCurrentVersion(actor.user.id);

  await writeAudit({
    entity: "link_set_versions",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code },
  });
  return Response.json({ id: created.id, warnings: [] }, { status: 201 });
}
