import { elementSchema, emptyTableState, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { rowStamp } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { ELEMENT_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import { elementDelete } from "@/lib/element-delete";
import { runStampedDelete } from "@/lib/stamped-delete";
import { guardUnique } from "@/lib/unique-violation";

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
      // 楽観的ロックの印。行の編集の保存時にそのまま送り返す
      stamp: rowStamp(e),
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

  const clash = async () => {
    const [bySymbol, byNumber] = await Promise.all([
      prisma.element.findUnique({ where: { symbol: v.symbol } }),
      prisma.element.findUnique({ where: { atomicNumber: v.atomicNumber } }),
    ]);
    if (bySymbol) return jsonError(409, "duplicate", m.elements.duplicateSymbol(v.symbol));
    if (byNumber) return jsonError(409, "duplicate", m.elements.duplicateNumber(v.atomicNumber));
    return null;
  };
  const clashed = await clash();
  if (clashed) return clashed;

  // 同じ記号・番号をほぼ同時に作られたら、一意の決まりで止まる。そのときもいつもの文で返す
  const created = await guardUnique(m, clash, () =>
    prisma.element.create({ data: { ...v, createdBy: actor.user.id } }),
  );
  if (created instanceof Response) return created;

  await writeAudit({
    entity: "elements",
    entityId: v.symbol,
    action: "create",
    actorId: actor.user.id,
    diff: { symbol: v.symbol, nameJa: v.nameJa },
  });
  return Response.json({ id: v.symbol, warnings: [] }, { status: 201 });
}

/**
 * DELETE /api/elements — まとめて削除（本文 `{ items: [{ id, stamp }], force? }`。lib/stamped-delete.ts）。
 * 元素（id は元素記号）。一覧を開いたあとでほかの人が変更していれば、何も消さずに知らせる
 */
export async function DELETE(req: Request) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  return runStampedDelete(req, m, elementDelete(actor, m));
}
