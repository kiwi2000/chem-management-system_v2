import { countrySchema, emptyTableState, normalizeCode, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { COUNTRY_INCLUDE, toCountryDto } from "@/lib/country-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { COUNTRY_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

const DEFAULT_STATE = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

/** GET /api/countries — 一覧 */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    COUNTRY_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );

  const where = { deletedAt: null, ...buildWhere(COUNTRY_COLUMNS, state.filters) };

  const [items, total] = await Promise.all([
    prisma.country.findMany({
      where,
      orderBy: buildOrderBy(COUNTRY_COLUMNS, state.sort, { displayOrder: "asc" }),
      include: COUNTRY_INCLUDE,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.country.count({ where }),
  ]);

  return Response.json({
    items: items.map(toCountryDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/**
 * POST /api/countries — 追加。
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
  const parsed = countrySchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  const region = await prisma.region.findFirst({ where: { id: v.regionId, deletedAt: null } });
  if (!region) return jsonError(404, "not_found", m.errors.notFound);

  const live = await prisma.country.findFirst({ where: { codeNormalized, deletedAt: null } });
  if (live) return jsonError(409, "duplicate_country_code", m.countries.duplicateCode(v.code));

  const data = {
    code: v.code,
    regionId: v.regionId,
    nameJa: v.nameJa,
    nameEn: v.nameEn ?? null,
    displayOrder: v.displayOrder,
    updatedBy: actor.user.id,
  };

  // 退避したコードは "<正規化コード>:<id>" の形で残っている
  const retired = await prisma.country.findFirst({
    where: { deletedAt: { not: null }, codeNormalized: { startsWith: `${codeNormalized}:` } },
    orderBy: { deletedAt: "desc" },
  });

  const warnings: string[] = [];
  let id: string;
  if (retired) {
    await prisma.country.update({
      where: { id: retired.id },
      data: { ...data, codeNormalized, deletedAt: null },
    });
    id = retired.id;
    warnings.push(m.countries.revived);
  } else {
    const created = await prisma.country.create({
      data: { ...data, codeNormalized, createdBy: actor.user.id },
    });
    id = created.id;
  }

  await writeAudit({
    entity: "countries",
    entityId: id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa, regionId: v.regionId },
  });
  return Response.json({ id, warnings }, { status: 201 });
}
