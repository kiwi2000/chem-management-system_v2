import {
  applyFilters,
  emptyTableState,
  normalizeCas,
  parseTableState,
  statutoryCasLinkSchema,
  type ColumnKind,
} from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { listCasLinks } from "@/lib/link-service";
import type { StatutoryCasLinkDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 絞り込み・並べ替えができる列。
 * データソースは表の上で選ぶので、ここには入れない（二重の入口を作らない）
 */
const CAS_LINK_COLUMNS = [
  { key: "casNumber", kind: "text" },
  { key: "casName", kind: "text" },
  { key: "excluded", kind: "enum" },
  { key: "used", kind: "enum" },
  { key: "note", kind: "text" },
] as const satisfies { key: string; kind: ColumnKind }[];

/** 並びはCAS番号の順。ここを変えると、どのデータソースが効いているか追いにくくなる */
const DEFAULT_STATE = emptyTableState([{ column: "casNumber", direction: "asc" }]);

/** 絞り込みと並べ替えで見る値。画面に出ているものと同じにする */
function cellOf(l: StatutoryCasLinkDto, column: string): string {
  switch (column) {
    case "casNumber":
      return l.casNumber;
    case "casName":
      // 画面は言語で出し分けるが、絞るときはどちらの名前でも当たってほしい
      return [l.substanceNameJa, l.substanceNameEn].filter(Boolean).join(" ");
    case "excluded":
      return l.excluded ? "excluded" : "applicable";
    case "used":
      return l.used ? "used" : "notUsed";
    case "note":
      return l.note ?? "";
    default:
      return "";
  }
}

/**
 * GET /api/statutory-cas-links — ある法文物質名に結び付いたCASの一覧。
 *
 * 1件の法文物質名に付くCASは知れた数なので、ページ送りはしない。
 *
 * **バージョン × データソースの組を1つだけ見る。**インベントリの中身と同じ決めかたで、
 * どちらも表の上のプルダウンで選ぶ。省いたときはバージョンが現在のもの、
 * データソースは絞らない。
 *
 * 「使用」は**絞る前の全データソース**で解く。選んでいないデータソースに
 * 優先度の高い行があれば、いま見ている行は採られていない
 */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  const params = new URL(req.url).searchParams;
  const statutorySubstanceId = params.get("statutorySubstanceId");
  if (!statutorySubstanceId) return jsonError(400, "validation_error", m.errors.validation);

  const versionId = params.get("versionId");
  const version = versionId
    ? await prisma.linkSetVersion.findFirst({ where: { id: versionId, deletedAt: null } })
    : await prisma.linkSetVersion.findFirst({ where: { isCurrent: true, deletedAt: null } });
  // バージョンが1つも無ければ書きようが無い。空で返し、画面には登録を促す文言を出す
  if (!version) return Response.json({ items: [], total: 0, page: 1, pageSize: 0, version: null });

  const all = await listCasLinks(version.id, statutorySubstanceId);
  const sourceId = params.get("sourceId");
  /*
    データソースを名指ししないときは**合算**。
    全部のデータソースを優先度の順に当てて、CASごとに採られた1行だけを返す。

    ここで全行を返していたときは、下位のデータソースの負けた行まで並び、
    「いま効いているのはどれか」が読めなかった。
    1つずつ見たいときは、データソースを選んでもらう
  */
  const picked = sourceId ? all.filter((l) => l.sourceId === sourceId) : all.filter((l) => l.used);

  /*
    絞り込みと並べ替えは**手元で行う。**1つの法文物質名ぶんは1回で引き切っており、
    条件を変えるたびに引き直す意味がない。条件の書き方はほかの表と同じ
  */
  const state = parseTableState(params, CAS_LINK_COLUMNS, DEFAULT_STATE);
  const filtered = applyFilters(picked, state.filters, cellOf);

  const sort = state.sort[0];
  const sorted = sort
    ? [...filtered].sort((a, b) => {
        const d = (cellOf(a, sort.column) ?? "").localeCompare(cellOf(b, sort.column) ?? "", "ja", {
          numeric: true,
        });
        return sort.direction === "desc" ? -d : d;
      })
    : filtered;

  const from = (state.page - 1) * state.pageSize;
  return Response.json({
    items: sorted.slice(from, from + state.pageSize),
    total: sorted.length,
    page: state.page,
    pageSize: state.pageSize,
    version: { id: version.id, code: version.code, isCurrent: version.isCurrent },
    sourceId,
  });
}

/** POST /api/statutory-cas-links — 1件足す */
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
  const parsed = statutoryCasLinkSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  const [version, substance, source] = await Promise.all([
    prisma.linkSetVersion.findFirst({ where: { id: v.versionId, deletedAt: null } }),
    prisma.statutorySubstance.findFirst({
      where: { id: v.statutorySubstanceId, deletedAt: null },
    }),
    prisma.source.findFirst({ where: { id: v.sourceId, deletedAt: null } }),
  ]);
  if (!version || !substance || !source) return jsonError(404, "not_found", m.errors.notFound);

  const casNormalized = normalizeCas(v.casNumber);
  const dup = await prisma.statutoryCasLink.findFirst({
    where: {
      versionId: v.versionId,
      statutorySubstanceId: v.statutorySubstanceId,
      casNormalized,
      sourceId: v.sourceId,
    },
  });
  if (dup) return jsonError(409, "duplicate", m.casLinks.duplicate);

  const created = await prisma.statutoryCasLink.create({
    data: {
      versionId: v.versionId,
      statutorySubstanceId: v.statutorySubstanceId,
      sourceId: v.sourceId,
      casNumber: v.casNumber,
      casNormalized,
      excluded: v.excluded,
      note: v.note ?? null,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "statutory_cas_links",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { casNumber: v.casNumber, sourceCode: source.code, excluded: v.excluded },
  });

  return Response.json({ id: created.id });
}
