import { emptyTableState, parseTableState, propertyDefSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PROPERTY_DEF_COLUMNS } from "@/lib/list-columns";
import { PROPERTY_DEF_COUNT, toPropertyDefDto } from "@/lib/property-def-service";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

/** 既定は表示順 */
const DEFAULT_STATE = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

/** GET /api/admin/property-defs — 管理画面用（使わない項目も含む）。用途は f.target で絞る */
export async function GET(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    PROPERTY_DEF_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = buildWhere(PROPERTY_DEF_COLUMNS, state.filters);

  const [items, total] = await Promise.all([
    prisma.propertyDef.findMany({
      where,
      orderBy: buildOrderBy(PROPERTY_DEF_COLUMNS, state.sort, { key: "asc" }),
      include: PROPERTY_DEF_COUNT,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.propertyDef.count({ where }),
  ]);

  return Response.json({
    items: items.map(toPropertyDefDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/admin/property-defs — 項目の追加 */
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
  const parsed = propertyDefSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  // キーは用途ごとに一意。物質と製品で同じキーを使ってよい
  const clash = await prisma.propertyDef.findUnique({
    where: { target_key: { target: v.target, key: v.key } },
  });
  if (clash) return jsonError(409, "duplicate_key", m.errors.duplicateKey(v.key));

  const created = await prisma.propertyDef.create({
    data: {
      target: v.target,
      key: v.key,
      labelJa: v.labelJa,
      labelEn: v.labelEn ?? null,
      dataType: v.dataType,
      defaultUnit: v.defaultUnit ?? null,
      displayOrder: v.displayOrder,
      activeFlag: v.activeFlag,
    },
  });

  await writeAudit({
    entity: "property_defs",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { target: v.target, key: v.key, labelJa: v.labelJa, dataType: v.dataType },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
