import { emptyTableState, parseTableState, propertyDefSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PROPERTY_DEF_COLUMNS } from "@/lib/list-columns";
import {
  PROPERTY_DEF_COUNT,
  syncPropertyOptions,
  toPropertyDefDto,
} from "@/lib/property-def-service";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import { propertyDefDelete } from "@/lib/property-def-delete";
import { runStampedDelete } from "@/lib/stamped-delete";
import { guardUnique } from "@/lib/unique-violation";

export const dynamic = "force-dynamic";

/** 既定は表示順 */
const DEFAULT_STATE = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

/** GET /api/admin/property-defs — 管理画面用（使わない項目も含む）。用途は f.target で絞る */
export async function GET(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    PROPERTY_DEF_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = buildWhere(PROPERTY_DEF_COLUMNS, state.filters);

  const [items, total] = await Promise.all([
    prisma.propertyDef.findMany({
      where,
      orderBy: buildOrderBy(PROPERTY_DEF_COLUMNS, state.sort, { key: "asc" }),
      include: PROPERTY_DEF_COUNT,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.propertyDef.count({ where }),
  ]);

  return Response.json({
    items: items.map(toPropertyDefDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/admin/property-defs — 項目の追加 */
export async function POST(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = propertyDefSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  // キーは用途ごとに一意。物質と製品で同じキーを使ってよい
  const clash = async () =>
    (await prisma.propertyDef.findUnique({
      where: { target_key: { target: v.target, key: v.key } },
    }))
      ? jsonError(409, "duplicate_key", m.errors.duplicateKey(v.key))
      : null;
  const clashed = await clash();
  if (clashed) return clashed;
  if (v.dataType === "CHOICE" && v.valueOptions.length === 0) {
    return jsonError(400, "validation_error", m.propertyDefs.choiceNeedsOptions);
  }

  // 管理者が足す項目は、システムの項目にはならない（system_flag は移行で入れたものだけ）
  // 同じキーをほぼ同時に作られたら、一意の決まりで止まる。そのときもいつもの文で返す
  const created = await guardUnique(m, clash, () =>
    prisma.$transaction(async (tx) => {
      const def = await tx.propertyDef.create({
        data: {
          target: v.target,
          key: v.key,
          labelJa: v.labelJa,
          labelEn: v.labelEn ?? null,
          dataType: v.dataType,
          defaultUnit: v.defaultUnit ?? null,
          displayOrder: v.displayOrder,
          activeFlag: v.activeFlag,
          group: v.group,
        },
      });
      if (v.dataType === "CHOICE") await syncPropertyOptions(tx, def, "VALUE", v.valueOptions);
      await syncPropertyOptions(tx, def, "CONDITION", v.conditionOptions);
      return def;
    }),
  );
  if (created instanceof Response) return created;

  await writeAudit({
    entity: "property_defs",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { target: v.target, key: v.key, labelJa: v.labelJa, dataType: v.dataType },
  });
  return Response.json({ id: created.id }, { status: 201 });
}

/** DELETE /api/admin/property-defs — まとめて消す（lib/stamped-delete.ts）。システムの項目は消せない */
export async function DELETE(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  return runStampedDelete(req, m, propertyDefDelete(actor, m));
}
