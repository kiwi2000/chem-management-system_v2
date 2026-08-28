import { emptyTableState, parseTableState } from "@chem/shared";
import { requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { currentVersion } from "@/lib/inventory-service";
import { INVENTORY_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import type { InventoryDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 既定の並びは、物質の画面に出す順。設定した並びをそのまま確かめられるようにする */
const DEFAULT_STATE = emptyTableState([{ column: "numberOrder", direction: "asc" }]);

/**
 * GET /api/inventories — インベントリの一覧。
 *
 * 件数は**現在のバージョンのぶん**を数える。インベントリは改訂されるので、
 * バージョンをまたいで合計すると、どのバージョンにも存在しない数になる。
 */
export async function GET(req: Request) {
  const T0 = Date.now();
  const actor = await requirePermission("REGULATION_VIEW");
  console.log("[調査] 権限", Date.now() - T0);
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    INVENTORY_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );

  const where = { deletedAt: null, ...buildWhere(INVENTORY_COLUMNS, state.filters) };
  const T1 = Date.now();
  const version = await currentVersion();
  console.log("[調査] バージョン", Date.now() - T1);

  const T2 = Date.now();
  const [items, total] = await Promise.all([
    prisma.inventory.findMany({
      where,
      orderBy: buildOrderBy(INVENTORY_COLUMNS, state.sort, { numberOrder: "asc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
      select: {
        id: true,
        code: true,
        countryId: true,
        nameOriginal: true,
        nameJa: true,
        nameEn: true,
        numberLabel: true,
        numberOrder: true,
        numberShown: true,
        updatedAt: true,
        country: { select: { nameJa: true, nameEn: true } },
      },
    }),
    prisma.inventory.count({ where }),
  ]);
  console.log("[調査] 一覧", Date.now() - T2);

  /*
    件数は一覧に出ているインベントリのぶんだけ数える。
    行は全部で95万件あるので、全インベントリぶんを毎回数えると重い
  */
  const T3 = Date.now();
  const counts = new Map<string, number>();
  if (version && items.length > 0) {
    const grouped = await prisma.inventoryRow.groupBy({
      by: ["inventoryId"],
      where: { versionId: version.id, inventoryId: { in: items.map((i) => i.id) } },
      _count: { _all: true },
    });
    for (const g of grouped) counts.set(g.inventoryId, g._count._all);
  }
  console.log("[調査] 件数", Date.now() - T3, "合計", Date.now() - T0);

  const dto: InventoryDto[] = items.map((i) => ({
    id: i.id,
    code: i.code,
    countryId: i.countryId,
    countryNameJa: i.country.nameJa,
    countryNameEn: i.country.nameEn,
    nameOriginal: i.nameOriginal,
    nameJa: i.nameJa,
    nameEn: i.nameEn,
    numberLabel: i.numberLabel,
    numberOrder: i.numberOrder,
    numberShown: i.numberShown,
    rowCount: counts.get(i.id) ?? 0,
    updatedAt: i.updatedAt.toISOString(),
  }));

  return Response.json({
    items: dto,
    total,
    page: state.page,
    pageSize: state.pageSize,
    version: version ? { code: version.code } : null,
  });
}
