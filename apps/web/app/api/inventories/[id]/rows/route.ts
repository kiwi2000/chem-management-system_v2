import { emptyTableState, inventoryRowSchema, normalizeCas, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { currentVersion, findSubstanceByCas, sourcesOfVersion } from "@/lib/inventory-service";
import { INVENTORY_ROW_COLUMNS } from "@/lib/list-columns";
import { mergedPageQuery, type MergedRow } from "@/lib/merged-rows-sql";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import type { InventoryRowDto } from "@/lib/types";

export const dynamic = "force-dynamic";

const DEFAULT_STATE = emptyTableState([{ column: "casNumber", direction: "asc" }]);

/**
 * GET /api/inventories/[id]/rows — インベントリの該当物質。
 *
 * **バージョン × データソースの組を1つだけ見る。**対象CAS（`statutory_cas_links`）の
 * 画面と同じ決めかたで、どちらも表の上のプルダウンで選ぶ。混ぜて出すと、
 * 同じCASが何行も並んでどれが効いているのか読めなくなる。
 *
 * 省いたときはバージョンが現在のもの、データソースは優先度がいちばん高いもの。
 * インベントリはURLで決まる（フィルターには置かない）。
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;

  const params = new URL(req.url).searchParams;
  const asked = params.get("versionId");
  const version = asked
    ? await prisma.linkSetVersion.findFirst({
        where: { id: asked, deletedAt: null },
        select: { id: true, code: true },
      })
    : await currentVersion();
  // バージョンが無ければ中身は決まらない。空で返し、画面はその旨を出す
  if (!version) {
    return Response.json({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
      version: null,
      sourceId: null,
    });
  }

  /*
    データソースは**そのバージョンに並んでいるものから選ぶ**。
    名指ししないときは**合算**（全部を優先度の順に当てて、CASごとに1行だけ）。
    並んでいるものに無いidを渡されたときも合算に落とす
  */
  const sources = await sourcesOfVersion(version.id);
  const askedSource = params.get("sourceId");
  const sourceId = askedSource && sources.some((s) => s.id === askedSource) ? askedSource : null;
  const merged = sourceId === null;

  const state = parseTableState(
    params,
    INVENTORY_ROW_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );

  const rank = new Map(sources.map((s) => [s.id, s.priority]));
  const rankOf = (sourceId: string) => rank.get(sourceId) ?? Number.MAX_SAFE_INTEGER;

  if (merged) {
    return Response.json(await mergedPage(id, version, state, sources));
  }

  const where = {
    versionId: version.id,
    inventoryId: id,
    sourceId,
    ...buildWhere(INVENTORY_ROW_COLUMNS, state.filters),
  };

  const [items, total] = await Promise.all([
    prisma.inventoryRow.findMany({
      where,
      orderBy: buildOrderBy(INVENTORY_ROW_COLUMNS, state.sort, { casNormalized: "asc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
      select: {
        id: true,
        sourceId: true,
        casNumber: true,
        casNormalized: true,
        value: true,
        updatedAt: true,
        source: { select: { code: true } },
      },
    }),
    prisma.inventoryRow.count({ where }),
  ]);

  // 一覧に出ている分だけ物質を引く（全件を持ってこない）
  const byCas = await findSubstanceByCas(items.map((r) => r.casNormalized));

  /*
    採られるかどうかは、**表に出ている行だけでは決められない。**
    選んでいないデータソースにも同じCASの行があるかもしれないので、
    そのバージョンの全データソースぶんを引き直して見る
  */
  const sameCas = await prisma.inventoryRow.findMany({
    where: {
      versionId: version.id,
      inventoryId: id,
      casNormalized: { in: [...new Set(items.map((r) => r.casNormalized))] },
    },
    select: { casNormalized: true, sourceId: true },
  });
  const best = new Map<string, number>();
  for (const r of sameCas) {
    const cur = best.get(r.casNormalized);
    const v = rankOf(r.sourceId);
    if (cur === undefined || v < cur) best.set(r.casNormalized, v);
  }

  const dto: InventoryRowDto[] = items.map((r) => ({
    id: r.id,
    sourceId: r.sourceId,
    sourceCode: r.source.code,
    used: rankOf(r.sourceId) === best.get(r.casNormalized),
    casNumber: r.casNumber,
    value: r.value,
    updatedAt: r.updatedAt.toISOString(),
    matchedSubstance: byCas.get(r.casNormalized) ?? null,
  }));

  return Response.json({
    items: dto,
    total,
    page: state.page,
    pageSize: state.pageSize,
    version: { id: version.id, code: version.code },
    sourceId,
  });
}

/**
 * 合算の1ページぶん。
 *
 * **データベース側で解く。**「CASごとにいちばん優先度の高い行」は `DISTINCT ON` で書ける。
 * 絞り込み・並べ替え・ページ送りも同じ問い合わせに乗るので、
 * 画面に出す25行だけが返ってくる。
 *
 * 前は全行をアプリに運んでから解いていた。13万行で0.7秒、運ぶ時間がほとんどで、
 * 合算の計算そのものは0.03秒だった。いまはどのページでも0.29秒（実測）。
 */
async function mergedPage(
  inventoryId: string,
  version: { id: string; code: string },
  state: ReturnType<typeof parseTableState>,
  sources: { id: string; code: string }[],
) {
  const codeOf = new Map(sources.map((s) => [s.id, s.code]));

  const { sql, values } = mergedPageQuery(version.id, inventoryId, state);
  const rows = await prisma.$queryRawUnsafe<MergedRow[]>(sql, ...values);

  // 件数は1ページぶんと一緒に返ってくる。行が無ければ0件
  const total = rows.length > 0 ? Number(rows[0]!.total) : 0;
  const byCas = await findSubstanceByCas(rows.map((r) => r.cas_normalized));

  const items: InventoryRowDto[] = rows.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    sourceCode: codeOf.get(r.source_id) ?? "",
    // 合算に残っている時点で、その行が採られたもの
    used: true,
    casNumber: r.cas_number,
    value: r.value,
    updatedAt: r.updated_at.toISOString(),
    matchedSubstance: byCas.get(r.cas_normalized) ?? null,
  }));

  return {
    items,
    total,
    page: state.page,
    pageSize: state.pageSize,
    version: { id: version.id, code: version.code },
    sourceId: null,
  };
}

/**
 * POST /api/inventories/[id]/rows — 行を足す。
 *
 * 入るのは**画面で選んでいるバージョンとデータソース**。対象CASの画面と同じ決めかた。
 * 省かれたときは現在のバージョンに入る。
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = inventoryRowSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  const asked = new URL(req.url).searchParams.get("versionId");
  const version = asked
    ? await prisma.linkSetVersion.findFirst({
        where: { id: asked, deletedAt: null },
        select: { id: true, code: true },
      })
    : await currentVersion();
  if (!version) return jsonError(409, "no_current_version", m.inventories.noCurrentVersion);

  const [inventory, source] = await Promise.all([
    prisma.inventory.findFirst({ where: { id, deletedAt: null } }),
    prisma.source.findFirst({ where: { id: v.sourceId, deletedAt: null } }),
  ]);
  if (!inventory || !source) return jsonError(404, "not_found", m.errors.notFound);

  const casNormalized = normalizeCas(v.casNumber);
  const dup = await prisma.inventoryRow.findFirst({
    where: {
      versionId: version.id,
      sourceId: v.sourceId,
      inventoryId: id,
      casNormalized,
      value: v.value,
    },
    select: { id: true },
  });
  if (dup) return jsonError(409, "duplicate_row", m.inventories.duplicateRow);

  const created = await prisma.inventoryRow.create({
    data: {
      versionId: version.id,
      sourceId: v.sourceId,
      inventoryId: id,
      casNumber: v.casNumber,
      casNormalized,
      value: v.value,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
    },
    select: { id: true },
  });

  await writeAudit({
    entity: "inventory_rows",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: {
      inventoryId: id,
      versionId: version.id,
      sourceId: v.sourceId,
      casNumber: v.casNumber,
      value: v.value,
    },
  });

  // 物質として未登録のCASでも入れられるが、打ち間違いに気づけるよう知らせる
  const matched = await findSubstanceByCas([casNormalized]);
  const warnings = matched.has(casNormalized) ? [] : [m.inventories.warnUnknownCas];
  return Response.json({ id: created.id, warnings }, { status: 201 });
}
