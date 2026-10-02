import {
  emptyTableState,
  parseTableState,
  PRTR_PRODUCT_METHODS,
  prtrQuantitySchema,
  type PrtrProductMethod,
} from "@chem/shared";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requirePrtrOrg } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PRTR_QUANTITY_COLUMNS } from "@/lib/list-columns";
import {
  findProductByCode,
  isConfirmed,
  QUANTITY_INCLUDE,
  toQuantityDto,
} from "@/lib/prtr-service";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const DEFAULT_STATE = emptyTableState([{ column: "productCode", direction: "asc" }]);

/**
 * GET /api/prtr/entries/[id]/quantities?method=BALANCE|FACTOR — 製品ごとの数量の一覧（絞り込み・並べ替え・ページ送り）。
 * `method` で区画（物質収支／排出係数）を選ぶ。無ければ両方
 */
export async function GET(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();
  const entry = await prisma.prtrEntry.findUnique({ where: { id } });
  if (!entry) return jsonError(404, "not_found", m.errors.notFound);
  const denied = await requirePrtrOrg(actor, entry.organisationId);
  if (denied) return denied;

  const url = new URL(req.url);
  const state = parseTableState(
    url.searchParams,
    PRTR_QUANTITY_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const methodParam = url.searchParams.get("method");
  const method = (PRTR_PRODUCT_METHODS as readonly string[]).includes(methodParam ?? "")
    ? (methodParam as PrtrProductMethod)
    : undefined;
  const where = {
    AND: [buildWhere(PRTR_QUANTITY_COLUMNS, state.filters)],
    entryId: id,
    ...(method ? { method } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.prtrQuantity.findMany({
      where,
      orderBy: buildOrderBy(PRTR_QUANTITY_COLUMNS, state.sort, { id: "asc" }),
      include: QUANTITY_INCLUDE,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.prtrQuantity.count({ where }),
  ]);
  return Response.json({
    items: items.map(toQuantityDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/**
 * POST /api/prtr/entries/[id]/quantities — 製品ごとの数量を 1 件足す（S22）。
 * `method` は区画（物質収支／排出係数）。同じ区画に同じ製品が既にあれば上書きする
 * （画面の 1 件登録は「同じ製品なら直す」の意味で使う）。取扱量・出荷量とも要る。確定中は断る
 */
export async function POST(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const entry = await prisma.prtrEntry.findUnique({ where: { id } });
  if (!entry) return jsonError(404, "not_found", m.errors.notFound);
  const denied = await requirePrtrOrg(actor, entry.organisationId);
  if (denied) return denied;
  if (await isConfirmed(id)) return jsonError(409, "confirmed", m.prtr.locked);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = prtrQuantitySchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const product = await findProductByCode(v.productCode);
  if (!product) {
    return jsonError(400, "validation_error", m.prtr.quantities.productNotFound(v.productCode), {
      fieldErrors: { productCode: [m.prtr.quantities.productNotFound(v.productCode)] },
    });
  }

  const data = {
    purchasedKg: new Prisma.Decimal(v.purchasedKg),
    shippedKg: new Prisma.Decimal(v.shippedKg),
    source: "MANUAL" as const,
    updatedBy: actor.user.id,
  };
  const row = await prisma.prtrQuantity.upsert({
    where: { entryId_method_productId: { entryId: id, method: v.method, productId: product.id } },
    create: { entryId: id, method: v.method, productId: product.id, ...data },
    update: data,
    include: QUANTITY_INCLUDE,
  });
  await writeAudit({
    entity: "prtr_quantities",
    entityId: row.id,
    action: "update",
    actorId: actor.user.id,
    diff: {
      product: product.code,
      method: v.method,
      purchasedKg: v.purchasedKg,
      shippedKg: v.shippedKg,
    },
  });
  return Response.json({ item: toQuantityDto(row) }, { status: 201 });
}
