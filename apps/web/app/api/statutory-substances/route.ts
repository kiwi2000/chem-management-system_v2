import {
  emptyTableState,
  normalizeCode,
  parseTableState,
  statutorySubstanceSchema,
} from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { SUBSTANCE_INCLUDE, toStatutorySubstanceDto } from "@/lib/law-service";
import { STATUTORY_SUBSTANCE_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

const DEFAULT_STATE = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

/** 日付だけの列なので、時刻を持たない UTC の 0時 として入れる */
const toDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00.000Z`) : null);

/** GET /api/statutory-substances — 一覧（分類で絞る） */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    STATUTORY_SUBSTANCE_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = { deletedAt: null, ...buildWhere(STATUTORY_SUBSTANCE_COLUMNS, state.filters) };

  const [items, total] = await Promise.all([
    prisma.statutorySubstance.findMany({
      where,
      orderBy: buildOrderBy(STATUTORY_SUBSTANCE_COLUMNS, state.sort, { displayOrder: "asc" }),
      include: SUBSTANCE_INCLUDE,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.statutorySubstance.count({ where }),
  ]);

  return Response.json({
    items: items.map(toStatutorySubstanceDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/statutory-substances — 追加 */
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
  const parsed = statutorySubstanceSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  const cls = await prisma.regulationClass.findFirst({ where: { id: v.classId, deletedAt: null } });
  if (!cls) return jsonError(404, "not_found", m.errors.notFound);

  const live = await prisma.statutorySubstance.findFirst({
    where: { classId: v.classId, codeNormalized, deletedAt: null },
  });
  if (live) {
    return jsonError(409, "duplicate_substance_code", m.statutorySubstances.duplicateCode(v.code));
  }

  const created = await prisma.statutorySubstance.create({
    data: {
      code: v.code,
      codeNormalized,
      classId: v.classId,
      officialNumber: v.officialNumber ?? null,
      nameOriginal: v.nameOriginal,
      nameLang: v.nameLang,
      nameJa: v.nameJa ?? null,
      nameEn: v.nameEn ?? null,
      thresholdLower: v.thresholdLower,
      lowerBound: v.lowerBound,
      thresholdUpper: v.thresholdUpper,
      upperBound: v.upperBound,
      effectiveFrom: toDate(v.effectiveFrom),
      effectiveTo: toDate(v.effectiveTo),
      displayOrder: v.displayOrder,
      note: v.note ?? null,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "statutory_substances",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code, nameOriginal: v.nameOriginal, classId: v.classId },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
