import { emptyTableState, normalizeCode, parseTableState, sourceSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { toSourceDto } from "@/lib/link-service";
import { SOURCE_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

const DEFAULT_STATE = emptyTableState([{ column: "code", direction: "asc" }]);

/** GET /api/sources — 一覧 */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    SOURCE_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = { deletedAt: null, ...buildWhere(SOURCE_COLUMNS, state.filters) };

  const [items, total] = await Promise.all([
    prisma.source.findMany({
      where,
      orderBy: buildOrderBy(SOURCE_COLUMNS, state.sort, { code: "asc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.source.count({ where }),
  ]);

  return Response.json({
    items: items.map(toSourceDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/sources — 追加。消したコードは復活させて使い回す */
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
  const parsed = sourceSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  const live = await prisma.source.findFirst({ where: { codeNormalized, deletedAt: null } });
  if (live) return jsonError(409, "duplicate_source_code", m.sources.duplicateCode(v.code));

  const data = { code: v.code, note: v.note ?? null, updatedBy: actor.user.id };

  const retired = await prisma.source.findFirst({
    where: { deletedAt: { not: null }, codeNormalized: { startsWith: `${codeNormalized}:` } },
    orderBy: { deletedAt: "desc" },
  });

  const warnings: string[] = [];
  let id: string;
  if (retired) {
    await prisma.source.update({
      where: { id: retired.id },
      data: { ...data, codeNormalized, deletedAt: null },
    });
    id = retired.id;
    warnings.push(m.sources.revived);
  } else {
    const created = await prisma.source.create({
      data: { ...data, codeNormalized, createdBy: actor.user.id },
    });
    id = created.id;
  }

  await writeAudit({
    entity: "sources",
    entityId: id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code },
  });
  return Response.json({ id, warnings }, { status: 201 });
}
