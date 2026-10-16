import { emptyTableState, inventoryRowSchema, normalizeCas, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { currentVersion, findSubstanceByCas, sourcesOfVersion } from "@/lib/inventory-service";
import { INVENTORY_ROW_COLUMNS } from "@/lib/list-columns";
import { ALL_SOURCES } from "@/lib/all-sources";
import { mergedPageQuery, type InventoryRowsMode, type MergedRow } from "@/lib/merged-rows-sql";
import type { InventoryRowDto } from "@/lib/types";

export const dynamic = "force-dynamic";

const DEFAULT_STATE = emptyTableState([{ column: "casNumber", direction: "asc" }]);

/**
 * GET /api/inventories/[id]/rows — インベントリの該当物質。
 *
 * **バージョンは1つだけ見る。**データソースは「採用」「すべて」か、1つ（対象CAS の画面と同じ選び方）。
 * 表の上のプルダウンで選ぶ。
 *
 * 省いたときはバージョンが現在のもの、データソースは採用。
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
    データソースは**そのバージョンに並んでいるものから選ぶ**（2026-10-17 に 3 通りにした）。
    - 名指ししない … **採用**（全部を優先度の順に当てて、CASごとに採られたデータソースの行だけ）
    - `__all` … **すべて**（並んでいる全部のデータソースの行。採られていない行も出す）
    - データソースの id … そのデータソースの行だけ
    並んでいるものに無いidを渡されたときは採用に落とす。
    `group=1` で、同じ CAS × データソースの行を 1 行にまとめる（値は「(1)-123, (2)-345」）
  */
  const sources = await sourcesOfVersion(version.id);
  const askedSource = params.get("sourceId");
  const mode: InventoryRowsMode =
    askedSource === ALL_SOURCES
      ? { kind: "all" }
      : askedSource && sources.some((s) => s.id === askedSource)
        ? { kind: "source", sourceId: askedSource }
        : { kind: "adopted" };
  const group = params.get("group") === "1";

  const state = parseTableState(
    params,
    INVENTORY_ROW_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );

  /*
    **データベース側で解く。**「CASごとにいちばん優先度の高いデータソースの行」は窓関数で書ける
    （`lib/merged-rows-sql.ts`）。絞り込み・並べ替え・ページ送り・まとめも同じ問い合わせに乗るので、
    画面に出す行だけが返ってくる
  */
  const { sql, values } = mergedPageQuery(version.id, id, state, { mode, group });
  const rows = await prisma.$queryRawUnsafe<MergedRow[]>(sql, ...values);

  // 件数は1ページぶんと一緒に返ってくる。行が無ければ0件
  const total = rows.length > 0 ? Number(rows[0]!.total) : 0;
  // 一覧に出ている分だけ物質を引く（全件を持ってこない）
  const byCas = await findSubstanceByCas(rows.map((r) => r.cas_normalized));

  const items: InventoryRowDto[] = rows.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    sourceCode: r.source_code,
    used: r.used,
    casNumber: r.cas_number,
    value: r.value,
    updatedAt: r.updated_at.toISOString(),
    matchedSubstance: byCas.get(r.cas_normalized) ?? null,
    grouped: group,
  }));

  return Response.json({
    items,
    total,
    page: state.page,
    pageSize: state.pageSize,
    version: { id: version.id, code: version.code },
    sourceId: mode.kind === "source" ? mode.sourceId : mode.kind === "all" ? ALL_SOURCES : null,
  });
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
