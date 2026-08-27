import { emptyTableState, normalizeCode, parseTableState, regionSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { REGION_ORDER_BY, isNaturalOrder } from "@/lib/law-order";
import { getServerMessages } from "@/lib/i18n";
import { REGION_COLUMNS } from "@/lib/list-columns";
import { toRegionDto } from "@/lib/region-service";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

/** 既定は並び順。同じ値なら地域コード順 */
const DEFAULT_STATE = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

/** GET /api/regions — 一覧 */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    REGION_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );

  const where = { deletedAt: null, ...buildWhere(REGION_COLUMNS, state.filters) };

  const [items, total] = await Promise.all([
    prisma.region.findMany({
      where,
      // 表示順が同じものが並ぶので、最後はコードで決める
      orderBy: isNaturalOrder(state.sort)
        ? [...REGION_ORDER_BY]
        : buildOrderBy(REGION_COLUMNS, state.sort, { displayOrder: "asc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.region.count({ where }),
  ]);

  return Response.json({
    items: items.map(toRegionDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/**
 * POST /api/regions — 追加。
 * 同じコードを論理削除していた場合は、その行を復活させて内容を更新する
 * （削除時にコードを退避させているので、退避先を探して戻す）。
 */
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
  const parsed = regionSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  const live = await prisma.region.findFirst({ where: { codeNormalized, deletedAt: null } });
  if (live) return jsonError(409, "duplicate_region_code", m.regions.duplicateCode(v.code));

  const data = {
    code: v.code,
    nameJa: v.nameJa,
    nameEn: v.nameEn ?? null,
    displayOrder: v.displayOrder,
    updatedBy: actor.user.id,
  };

  // 退避したコードは "<正規化コード>:<id>" の形で残っている
  const retired = await prisma.region.findFirst({
    where: { deletedAt: { not: null }, codeNormalized: { startsWith: `${codeNormalized}:` } },
    orderBy: { deletedAt: "desc" },
  });

  const warnings: string[] = [];
  let id: string;
  if (retired) {
    await prisma.region.update({
      where: { id: retired.id },
      data: { ...data, codeNormalized, deletedAt: null },
    });
    id = retired.id;
    warnings.push(m.regions.revived);
  } else {
    const created = await prisma.region.create({
      data: { ...data, codeNormalized, createdBy: actor.user.id },
    });
    id = created.id;
  }

  await writeAudit({
    entity: "regions",
    entityId: id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa },
  });
  return Response.json({ id, warnings }, { status: 201 });
}
