import { emptyTableState, parseTableState, substanceSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { SUBSTANCE_COLUMNS } from "@/lib/list-columns";
import { listNumbersByCas } from "@/lib/substance-numbers";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import {
  SUBSTANCE_LIST_INCLUDE,
  childWrites,
  collectWarnings,
  ensureCasRepresentative,
  makeCasRepresentative,
  hasDuplicateGazette,
  normalizeInput,
  toListItem,
  visibilityWhere,
  validateCas,
} from "@/lib/substance-service";
import { validatePropertyValues } from "@/lib/property-values";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** 既定の並びはコード順 */
const DEFAULT_STATE = emptyTableState([{ column: "code", direction: "asc" }]);

/**
 * GET /api/substances — 一覧。
 * 並べ替え・列ごとのフィルター・ページングはクエリで受け取る（形式は @chem/shared の table.ts）。
 */
export async function GET(req: Request) {
  const actor = await requirePermission("SUBSTANCE_VIEW");
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    SUBSTANCE_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );

  const where = {
    deletedAt: null,
    ...visibilityWhere(actor),
    ...buildWhere(SUBSTANCE_COLUMNS, state.filters),
  };

  const [items, total] = await Promise.all([
    prisma.substance.findMany({
      where,
      include: SUBSTANCE_LIST_INCLUDE,
      orderBy: buildOrderBy(SUBSTANCE_COLUMNS, state.sort, { codeNormalized: "asc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.substance.count({ where }),
  ]);

  // 各種番号はCASリンクから引く。1ページぶんをまとめて1回で取る（決定 0008）
  const numbers = await listNumbersByCas(items.map((s) => s.casNormalized ?? ""));
  const rows = items.map((s) => ({
    ...toListItem(s),
    numbers: (numbers.get(s.casNormalized ?? "") ?? []).map((n) => ({
      label: n.label,
      number: n.number,
    })),
  }));

  return Response.json({
    items: rows,
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/substances — 新規登録 */
export async function POST(req: Request) {
  const actor = await requirePermission("SUBSTANCE_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = substanceSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const input = parsed.data;

  if (hasDuplicateGazette(input)) {
    return jsonError(400, "duplicate_gazette", m.errors.duplicateGazette);
  }

  const defs = await prisma.propertyDef.findMany({ where: { target: "SUBSTANCE" } });
  const propErrors = validatePropertyValues(input.properties, defs, m);
  if (propErrors.length > 0) {
    return jsonError(400, "validation_error", propErrors[0] ?? m.errors.validation);
  }

  // 新規登録は必ず作成中から始める（公開させるのは意識的な操作にする）
  const base = normalizeInput(input);
  const settings = await getAppSettings();
  const casError = validateCas(base.casNormalized, settings, m);
  if (casError) return jsonError(400, "validation_error", casError);

  if (await prisma.substance.findUnique({ where: { codeNormalized: base.codeNormalized } })) {
    return jsonError(409, "duplicate_code", m.errors.duplicateCode(base.code));
  }

  const children = childWrites(input);
  const created = await prisma.substance.create({
    data: {
      ...base,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
      aliases: { create: children.aliases },
      gazetteNumbers: { create: children.gazetteNumbers },
      properties: { create: children.properties },
    },
  });

  /*
   * 代表物質の割り当て。
   * そのCASに他がいなければ自動で代表になる（人に聞くことは何も無い）。
   * 他がいるときは、画面で選ばせた結果が casRepresentative で届く。
   */
  if (base.casNormalized) {
    if (input.casRepresentative) {
      await makeCasRepresentative(prisma, created.id, base.casNormalized);
    } else {
      await ensureCasRepresentative(prisma, base.casNormalized);
    }
  }

  await writeAudit({
    entity: "substances",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: base.code, casNumber: base.casNumber, mainNameJa: input.mainNameJa },
  });

  const warnings = await collectWarnings(base.casNormalized, created.id, settings, m);
  return Response.json({ id: created.id, warnings }, { status: 201 });
}
