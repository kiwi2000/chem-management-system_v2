import { emptyTableState, parseTableState, productSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PRODUCT_COLUMNS } from "@/lib/list-columns";
import {
  FLAG_DEFAULTS,
  PRODUCT_LIST_INCLUDE,
  checkFlagPermissions,
  childWrites,
  normalizeInput,
  toListItem,
  visibilityWhere,
} from "@/lib/product-service";
import { validatePropertyValues } from "@/lib/property-values";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

/** 既定の並びはコード順 */
const DEFAULT_STATE = emptyTableState([{ column: "code", direction: "asc" }]);

/**
 * GET /api/products — 一覧。
 * 非公開の製品は、権限が無ければ件数にも入れない（存在ごと隠す）。
 */
export async function GET(req: Request) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    PRODUCT_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );

  const where = {
    deletedAt: null,
    ...visibilityWhere(actor),
    ...buildWhere(PRODUCT_COLUMNS, state.filters),
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: PRODUCT_LIST_INCLUDE,
      orderBy: buildOrderBy(PRODUCT_COLUMNS, state.sort, { codeNormalized: "asc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return Response.json({
    items: items.map(toListItem),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/products — 新規登録 */
export async function POST(req: Request) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = productSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const input = parsed.data;

  // 新規は「既定値から変えたか」で判断する
  const flagError = checkFlagPermissions(input, FLAG_DEFAULTS, actor, m);
  if (flagError) return jsonError(403, "forbidden", flagError);

  const defs = await prisma.propertyDef.findMany({ where: { target: "PRODUCT" } });
  const propErrors = validatePropertyValues(input.properties, defs, m);
  if (propErrors.length > 0) {
    return jsonError(400, "validation_error", propErrors[0] ?? m.errors.validation);
  }

  const base = normalizeInput(input);
  if (await prisma.product.findUnique({ where: { codeNormalized: base.codeNormalized } })) {
    return jsonError(409, "duplicate_code", m.errors.duplicateProductCode(base.code));
  }

  const children = childWrites(input);
  const created = await prisma.product.create({
    data: {
      ...base,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
      aliases: { create: children.aliases },
      properties: { create: children.properties },
    },
  });

  await writeAudit({
    entity: "products",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: base.code, nameJa: base.nameJa, privateFlag: base.privateFlag },
  });

  // 警告の中身は組成（S8）ができてから増える
  return Response.json({ id: created.id, warnings: [] }, { status: 201 });
}
