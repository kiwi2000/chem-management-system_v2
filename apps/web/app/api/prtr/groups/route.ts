import { emptyTableState, normalizeCode, parseTableState, prtrGroupSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import {
  jsonError,
  prtrGroupWhere,
  prtrScopeOf,
  requireAnyPermission,
  requirePermission,
} from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PRTR_GROUP_COLUMNS } from "@/lib/list-columns";
import { nextDisplayOrder, PRTR_GROUP_INCLUDE, toPrtrGroupDto } from "@/lib/prtr-service";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

const DEFAULT_STATE = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

/**
 * GET /api/prtr/groups — グループの一覧（S22-1）。
 * **担当の範囲で絞る。**工場担当には自分の工場が属するグループだけ、管理者には全部
 */
export async function GET(req: Request) {
  const actor = await requireAnyPermission("PRTR_SITE", "PRTR_GROUP", "PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const scope = await prtrScopeOf(actor);

  const state = parseTableState(
    new URL(req.url).searchParams,
    PRTR_GROUP_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = {
    ...buildWhere(PRTR_GROUP_COLUMNS, state.filters),
    ...prtrGroupWhere(scope),
    deletedAt: null,
  };
  const [items, total] = await Promise.all([
    prisma.prtrGroup.findMany({
      where,
      orderBy: buildOrderBy(PRTR_GROUP_COLUMNS, state.sort, { displayOrder: "asc" }),
      include: PRTR_GROUP_INCLUDE,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.prtrGroup.count({ where }),
  ]);
  return Response.json({
    items: items.map(toPrtrGroupDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/prtr/groups — 追加（PRTR 管理者） */
export async function POST(req: Request) {
  const actor = await requirePermission("PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = prtrGroupSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);
  if (await prisma.prtrGroup.findFirst({ where: { codeNormalized } })) {
    return jsonError(409, "duplicate", m.prtr.groups.duplicateCode(v.code));
  }

  const created = await prisma.prtrGroup.create({
    data: {
      code: v.code,
      codeNormalized,
      nameJa: v.nameJa,
      nameKana: v.nameKana ?? null,
      nameEn: v.nameEn ?? null,
      zip: v.zip ?? null,
      prefecture: v.prefecture ?? null,
      city: v.city ?? null,
      town: v.town ?? null,
      prefectureKana: v.prefectureKana ?? null,
      cityKana: v.cityKana ?? null,
      townKana: v.townKana ?? null,
      employeeNum: v.employeeNum ?? null,
      displayOrder: v.displayOrder ?? (await nextDisplayOrder("prtrGroup")),
      note: v.note ?? null,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
    },
  });
  await writeAudit({
    entity: "prtr_groups",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
