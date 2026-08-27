import {
  emptyTableState,
  normalizeCode,
  parseTableState,
  regulationCategorySchema,
} from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { countSubstancesByCategory, ensureDefaultClass, toCategoryDto } from "@/lib/law-service";
import { REGULATION_CATEGORY_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

const DEFAULT_STATE = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

/** GET /api/regulation-categories — 一覧（法令で絞る） */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    REGULATION_CATEGORY_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = { deletedAt: null, ...buildWhere(REGULATION_CATEGORY_COLUMNS, state.filters) };

  const [items, total] = await Promise.all([
    prisma.regulationCategory.findMany({
      where,
      orderBy: buildOrderBy(REGULATION_CATEGORY_COLUMNS, state.sort, { displayOrder: "asc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.regulationCategory.count({ where }),
  ]);

  // 分類を1段はさむので、法文物質名の数は別に数える
  const counts = await countSubstancesByCategory(items.map((c) => c.id));

  return Response.json({
    items: items.map((c) => toCategoryDto(c, counts.get(c.id) ?? 0)),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/**
 * POST /api/regulation-categories — 追加。
 * 作ったあと、名前のない分類を必ず1件添える（法文物質名の親を常に分類にするため）。
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
  const parsed = regulationCategorySchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  const law = await prisma.law.findFirst({ where: { id: v.lawId, deletedAt: null } });
  if (!law) return jsonError(404, "not_found", m.errors.notFound);

  const live = await prisma.regulationCategory.findFirst({
    where: { lawId: v.lawId, codeNormalized, deletedAt: null },
  });
  if (live) {
    return jsonError(409, "duplicate_category_code", m.regulationCategories.duplicateCode(v.code));
  }

  const created = await prisma.regulationCategory.create({
    data: {
      code: v.code,
      codeNormalized,
      lawId: v.lawId,
      nameOriginal: v.nameOriginal,
      nameLang: v.nameLang,
      nameJa: v.nameJa ?? null,
      nameEn: v.nameEn ?? null,
      thresholdLower: v.thresholdLower,
      lowerBound: v.lowerBound,
      thresholdUpper: v.thresholdUpper,
      upperBound: v.upperBound,
      thresholdBasis: v.thresholdBasis,
      interactionGroup: v.interactionGroup ?? null,
      rank: v.rank ?? null,
      displayOrder: v.displayOrder,
      note: v.note ?? null,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
    },
  });

  await ensureDefaultClass(created.id, actor.user.id);

  await writeAudit({
    entity: "regulation_categories",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code, nameOriginal: v.nameOriginal, lawId: v.lawId },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
