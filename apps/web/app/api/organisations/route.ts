import {
  duplicateLabels,
  emptyTableState,
  organisationSchema,
  parseTableState,
} from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { ORGANISATION_COLUMNS } from "@/lib/list-columns";
import {
  ORG_INCLUDE,
  toOrganisationDto,
  setDefaultGroups,
  validParent,
  defaultGroupsByOrg,
} from "@/lib/organisation-service";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

const DEFAULT_STATE = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

/** GET /api/organisations — 組織の一覧（項目も一緒に返す） */
export async function GET(req: Request) {
  /*
    **見るのは誰でも。**帳票の宛先に選ぶために一覧が要る。
    書き換えだけを ORG_EDIT で守る
  */
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    ORGANISATION_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = { ...buildWhere(ORGANISATION_COLUMNS, state.filters), deletedAt: null };

  const [items, total] = await Promise.all([
    prisma.organisation.findMany({
      where,
      orderBy: buildOrderBy(ORGANISATION_COLUMNS, state.sort, { displayOrder: "asc" }),
      include: ORG_INCLUDE,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.organisation.count({ where }),
  ]);

  // 最初に選ばれる権限グループはシステム設定の一部なので、システム管理グループの人にだけ返す（S31）
  const defaults = actor.isSystemAdmin ? await defaultGroupsByOrg() : null;
  return Response.json({
    items: items.map((o) => ({
      ...toOrganisationDto(o),
      ...(defaults ? { defaultGroupIds: defaults.get(o.id) ?? [] } : {}),
    })),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/organisations — 組織の追加 */
export async function POST(req: Request) {
  const actor = await requirePermission("ORG_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = organisationSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  const dup = duplicateLabels(v.items);
  if (dup.length > 0) {
    return jsonError(400, "validation_error", m.validation.duplicateLabel(dup[0]!));
  }
  if (await prisma.organisation.findFirst({ where: { code: v.code, deletedAt: null } })) {
    return jsonError(409, "duplicate_code", m.organisations.duplicateCode(v.code));
  }
  if (!(await validParent(null, v.parentId ?? null))) {
    return jsonError(400, "validation_error", m.organisations.badParent, {
      fieldErrors: { parentId: [m.organisations.badParent] },
    });
  }

  const created = await prisma.organisation.create({
    data: {
      code: v.code,
      // 種別と呼び名（2026-11-10 に保存していなかったのを直した）
      kind: v.kind,
      kindLabel: v.kind === "OTHER" ? (v.kindLabel ?? null) : null,
      parentId: v.parentId ?? null,
      nameJa: v.nameJa,
      nameEn: v.nameEn ?? null,
      displayOrder: v.displayOrder,
      activeFlag: v.activeFlag,
      items: {
        create: v.items.map((x, i) => ({ label: x.label, value: x.value, displayOrder: i })),
      },
    },
  });

  // 最初に選ばれる権限グループはシステム設定の一部。システム管理グループの人が送ったときだけ（S31）
  if (actor.isSystemAdmin && v.defaultGroupIds)
    await setDefaultGroups(created.id, v.defaultGroupIds);

  await writeAudit({
    entity: "organisations",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa, items: v.items.length },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
