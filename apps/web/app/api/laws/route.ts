import { emptyTableState, lawSchema, normalizeCode, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { LAW_INCLUDE, toLawDto } from "@/lib/law-service";
import { LAW_ORDER_BY } from "@/lib/law-order";
import { LAW_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

/*
  **並べ替えを選んでいないときの既定は、こちらでは決めない。**
  `displayOrder` だけで並べると、番号が国ごとに1から振ってあるため国が混ざる
  （韓国POPs法 50 が化管法 50 に割り込む）。下の `LAW_ORDER_BY` を使う
*/
const DEFAULT_STATE = emptyTableState([]);

/** GET /api/laws — 一覧 */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    LAW_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = { deletedAt: null, ...buildWhere(LAW_COLUMNS, state.filters) };

  const [items, total] = await Promise.all([
    prisma.law.findMany({
      where,
      // 選んでいなければ 地域 → 国 → 法令。選んでいればその列で並べる
      orderBy:
        state.sort.length === 0
          ? [...LAW_ORDER_BY]
          : buildOrderBy(LAW_COLUMNS, state.sort, { displayOrder: "asc" }),
      include: LAW_INCLUDE,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.law.count({ where }),
  ]);

  return Response.json({
    items: items.map(toLawDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/laws — 追加。同じコードを消していた場合はその行を復活させる */
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
  const parsed = lawSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  const country = await prisma.country.findFirst({ where: { id: v.countryId, deletedAt: null } });
  if (!country) return jsonError(404, "not_found", m.errors.notFound);

  const live = await prisma.law.findFirst({ where: { codeNormalized, deletedAt: null } });
  if (live) return jsonError(409, "duplicate_law_code", m.laws.duplicateCode(v.code));

  const data = {
    code: v.code,
    countryId: v.countryId,
    nameOriginal: v.nameOriginal,
    nameLang: v.nameLang,
    nameJa: v.nameJa ?? null,
    nameEn: v.nameEn ?? null,
    displayOrder: v.displayOrder,
    note: v.note ?? null,
    updatedBy: actor.user.id,
  };

  const retired = await prisma.law.findFirst({
    where: { deletedAt: { not: null }, codeNormalized: { startsWith: `${codeNormalized}:` } },
    orderBy: { deletedAt: "desc" },
  });

  const warnings: string[] = [];
  let id: string;
  if (retired) {
    await prisma.law.update({
      where: { id: retired.id },
      data: { ...data, codeNormalized, deletedAt: null },
    });
    id = retired.id;
    warnings.push(m.laws.revived);
  } else {
    const created = await prisma.law.create({
      data: { ...data, codeNormalized, createdBy: actor.user.id },
    });
    id = created.id;
  }

  await writeAudit({
    entity: "laws",
    entityId: id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code, nameOriginal: v.nameOriginal, countryId: v.countryId },
  });
  return Response.json({ id, warnings }, { status: 201 });
}
