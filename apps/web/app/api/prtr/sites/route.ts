import { emptyTableState, normalizeCode, parseTableState, prtrSiteSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import {
  jsonError,
  prtrScopeOf,
  prtrSiteWhere,
  requireAnyPermission,
  requirePermission,
} from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PRTR_SITE_COLUMNS } from "@/lib/list-columns";
import { nextDisplayOrder, PRTR_SITE_INCLUDE, toPrtrSiteDto } from "@/lib/prtr-service";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

const DEFAULT_STATE = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

/**
 * GET /api/prtr/sites — 工場の一覧（S22-1）。
 * **担当の範囲で絞る。**工場担当には自分の工場、グループ担当にはグループの工場、管理者には全部
 */
export async function GET(req: Request) {
  /*
    システム管理者は PRTR の権限が無くても一覧だけは引ける（利用者の画面で担当を割り当てるため）。
    **一覧だけ。**データの API はこの例外を持たない（システム管理者に工場のデータを見せない）
  */
  const actor = await requireAnyPermission("PRTR_SITE", "PRTR_GROUP", "PRTR_ADMIN", "ADMIN");
  if (actor instanceof Response) return actor;
  const scope = actor.has("ADMIN")
    ? { all: true, groupIds: [], siteIds: [] }
    : await prtrScopeOf(actor);

  const state = parseTableState(
    new URL(req.url).searchParams,
    PRTR_SITE_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  // 絞り込みと担当の範囲は AND で重ねる（どちらも OR を持ちうるので、広げて混ぜない）
  const where = {
    AND: [buildWhere(PRTR_SITE_COLUMNS, state.filters), prtrSiteWhere(scope)],
    deletedAt: null,
  };
  const [items, total] = await Promise.all([
    prisma.prtrSite.findMany({
      where,
      orderBy: buildOrderBy(PRTR_SITE_COLUMNS, state.sort, { displayOrder: "asc" }),
      include: PRTR_SITE_INCLUDE,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.prtrSite.count({ where }),
  ]);
  return Response.json({
    items: items.map(toPrtrSiteDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/prtr/sites — 追加（PRTR 管理者） */
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
  const parsed = prtrSiteSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);
  if (await prisma.prtrSite.findFirst({ where: { codeNormalized } })) {
    return jsonError(409, "duplicate", m.prtr.sites.duplicateCode(v.code));
  }
  if (!(await prisma.prtrGroup.findFirst({ where: { id: v.groupId, deletedAt: null } }))) {
    return jsonError(400, "validation_error", m.prtr.sites.groupMissing);
  }

  const created = await prisma.prtrSite.create({
    data: {
      code: v.code,
      codeNormalized,
      groupId: v.groupId,
      nameJa: v.nameJa,
      nameEn: v.nameEn ?? null,
      displayOrder: v.displayOrder ?? (await nextDisplayOrder("prtrSite")),
      note: v.note ?? null,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
    },
  });
  await writeAudit({
    entity: "prtr_sites",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa, groupId: v.groupId },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
