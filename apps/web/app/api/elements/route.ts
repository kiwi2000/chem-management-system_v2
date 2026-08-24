import { elementSchema, emptyTableState, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { ELEMENT_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

/** 既定は元素番号の昇順。周期表と同じ並びになる */
const DEFAULT_STATE = emptyTableState([{ column: "atomicNumber", direction: "asc" }]);

/** GET /api/elements — 一覧 */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    ELEMENT_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = { deletedAt: null, ...buildWhere(ELEMENT_COLUMNS, state.filters) };

  const [items, total] = await Promise.all([
    prisma.element.findMany({
      where,
      orderBy: buildOrderBy(ELEMENT_COLUMNS, state.sort, { atomicNumber: "asc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.element.count({ where }),
  ]);

  return Response.json({
    items: items.map((e) => ({
      symbol: e.symbol,
      atomicNumber: e.atomicNumber,
      nameJa: e.nameJa,
      nameEn: e.nameEn,
    })),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/elements — 追加 */
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
  const parsed = elementSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  const [bySymbol, byNumber] = await Promise.all([
    prisma.element.findUnique({ where: { symbol: v.symbol } }),
    prisma.element.findUnique({ where: { atomicNumber: v.atomicNumber } }),
  ]);
  if (bySymbol) return jsonError(409, "duplicate", m.elements.duplicateSymbol(v.symbol));
  if (byNumber) return jsonError(409, "duplicate", m.elements.duplicateNumber(v.atomicNumber));

  await prisma.element.create({ data: { ...v, createdBy: actor.user.id } });

  await writeAudit({
    entity: "elements",
    entityId: v.symbol,
    action: "create",
    actorId: actor.user.id,
    diff: { symbol: v.symbol, nameJa: v.nameJa },
  });
  return Response.json({ id: v.symbol, warnings: [] }, { status: 201 });
}
