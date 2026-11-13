import { parseTableState, productSchema, activeOnlyState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { compositionFilterLimit } from "@/lib/product-list-limit";
import { getServerMessages } from "@/lib/i18n";
import { resolveOwnerForCreate } from "@/lib/owner-group";
import { getCurrentVersion } from "@/lib/current-version";
import { compositionScopeOf, productColumns, substanceNameWords } from "@/lib/list-columns";
import {
  productListInclude,
  childWrites,
  normalizeInput,
  toListItem,
  visibilityWhere,
} from "@/lib/product-service";
import { lookupSubstanceNames } from "@/lib/substance-name-lookup";
import { validatePropertyValues } from "@/lib/property-values";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

/** 既定の並びはコード順 */
// 既定は「有効のみ」（S31）。画面（components/*-list-columns.tsx）と同じ既定にする
const DEFAULT_STATE = activeOnlyState([{ column: "code", direction: "asc" }]);

/**
 * GET /api/products — 一覧。
 * 非公開の製品は、権限が無ければ件数にも入れない（存在ごと隠す）。
 */
export async function GET(req: Request) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;

  // 判定の列と絞り込みは、現在の法規制バージョンの行で見る。組成をたどる絞り込みは見られる人だけ
  const version = await getCurrentVersion();
  const withComposition = actor.has("COMPOSITION_VIEW");
  const keys = productColumns(version?.id ?? null, withComposition);
  const state = parseTableState(
    new URL(req.url).searchParams,
    keys.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  // 組成をたどる絞り込みが見る組成の種類は絞り込みの値で決まる。物質名は展開結果の表のために先に物質を引く
  const columns = productColumns(
    version?.id ?? null,
    withComposition,
    compositionScopeOf(state.filters),
    withComposition ? await lookupSubstanceNames(substanceNameWords(state.filters)) : undefined,
  );

  // 組成をたどる絞り込みは、組成を見られる製品だけに限る（S31）
  const compositionLimit = withComposition
    ? await compositionFilterLimit(actor, version?.id ?? null, columns, state.filters)
    : {};

  const where = {
    deletedAt: null,
    ...visibilityWhere(actor),
    ...compositionLimit,
    ...buildWhere(columns, state.filters),
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: productListInclude(version?.id ?? null),
      orderBy: buildOrderBy(columns, state.sort, { codeNormalized: "asc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return Response.json({
    items: items.map((p) => toListItem(p, version?.id ?? null)),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/products — 新規登録 */
export async function POST(req: Request) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = productSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const input = parsed.data;

  const defs = await prisma.propertyDef.findMany({
    where: { target: "PRODUCT" },
    include: { options: true },
  });
  const propErrors = validatePropertyValues(input.properties, defs, m);
  if (propErrors.length > 0) {
    return jsonError(400, "validation_error", propErrors[0] ?? m.errors.validation);
  }

  // 新規登録は必ず作成中から始める（公開させるのは意識的な操作にする）
  const base = normalizeInput(input);
  const clash = await prisma.product.findUnique({
    where: { codeNormalized: base.codeNormalized },
    select: { id: true },
  });
  if (clash) {
    // 見えないものと重なるときは理由を言わない（S31 仕様 7 章。見えないものの存在を知らせない）
    const seen = await prisma.product.count({ where: { id: clash.id, ...visibilityWhere(actor) } });
    return jsonError(
      409,
      "duplicate_code",
      seen ? m.errors.duplicateProductCode(base.code) : m.owner.codeUnavailable,
      {
        fieldErrors: {
          code: [seen ? m.errors.duplicateProductCode(base.code) : m.owner.codeUnavailable],
        },
      },
    );
  }

  // 所属先（S31）。「製品・原材料 編集」の印を持つ管理グループから
  const owner = await resolveOwnerForCreate(actor, "productEdit", input.ownerGroupId);
  if (owner instanceof Response) return owner;

  const children = childWrites(input);
  const created = await prisma.product.create({
    data: {
      ...base,
      ownerGroupId: owner,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
      aliases: { create: children.aliases },
      uses: { create: children.uses },
      properties: { create: children.properties },
    },
  });

  await writeAudit({
    entity: "products",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: base.code, nameJa: base.nameJa },
  });

  // 警告の中身は組成（S8）ができてから増える
  return Response.json({ id: created.id, warnings: [] }, { status: 201 });
}
