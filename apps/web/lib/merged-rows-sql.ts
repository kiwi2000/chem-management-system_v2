import type { ColumnFilter, TableState } from "@chem/shared";
import { normalizeCas } from "@chem/shared";

/**
 * 合算（データソースを名指ししないとき）の1ページを、データベース側で解くための組み立て。
 *
 * **アプリに全行を運ばない。**13万行を運ぶだけで0.7秒かかっていた。
 * CASごとに優先度のいちばん高いデータソースを選ぶのは窓関数（`rank() OVER`）で書け、
 * 絞り込みも並べ替えもページ送りも、同じ問い合わせの中で済む。
 *
 * **値は必ず番号（`$1`）で渡す。**画面から来た文字をSQLに混ぜない。
 */

/** 数字を数として読む並べ方。移行 20260828050000 で作る */
const NATURAL = 'COLLATE "chem_natural"';

/** LIKE で特別な意味を持つ文字を、ただの文字として扱わせる */
function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => "\\" + c);
}

/** 日付は「その日いっぱい」を含める（table-query.ts の絞り込みと同じ扱い） */
function dayStart(v: string): Date | null {
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function dayEnd(v: string): Date | null {
  const d = new Date(`${v}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** SQL の列名。画面のキーと違うので、ここで対応を持つ */
const COLUMN: Record<string, string> = {
  casNumber: "cas_normalized",
  value: "value",
  // データソースの列（2026-10-17）。コードで絞り込み・並べ替えする
  sourceCode: "source_code",
  updatedAt: "updated_at",
};

/** 値を集めながら `$1` を振っていく。SQL に文字をそのまま埋めないための入れ物 */
class Bind {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

function textWhere(
  col: string,
  f: Extract<ColumnFilter, { kind: "text" }>,
  bind: Bind,
): string | null {
  if (f.op === "empty") return `(${col} IS NULL OR ${col} = '')`;
  if (f.op === "notEmpty") return `(${col} IS NOT NULL AND ${col} <> '')`;

  // CAS番号は揃えた形で持っているので、絞る値も同じ形に直してから当てる
  const raw = col === "cas_normalized" ? normalizeCas(f.value) : f.value;
  // 「値」とデータソースは大文字小文字を区別しない（一致でも同じ）
  const ci = col === "value" || col === "source_code";
  if (f.op === "equals")
    return ci ? `lower(${col}) = lower(${bind.add(raw)})` : `${col} = ${bind.add(raw)}`;

  const esc = escapeLike(raw);
  const pattern = f.op === "startsWith" ? `${esc}%` : f.op === "endsWith" ? `%${esc}` : `%${esc}%`;
  // 部分一致も同じく区別しない（table-query.ts の caseInsensitive と同じ）
  const op = ci ? "ILIKE" : "LIKE";
  return `${col} ${op} ${bind.add(pattern)} ESCAPE '\\'`;
}

function dateWhere(
  col: string,
  f: Extract<ColumnFilter, { kind: "date" }>,
  bind: Bind,
): string | null {
  if (f.op === "empty") return `${col} IS NULL`;
  if (f.op === "notEmpty") return `${col} IS NOT NULL`;

  const from = dayStart(f.value);
  if (!from) return null;
  if (f.op === "from") return `${col} >= ${bind.add(from)}`;
  if (f.op === "to") {
    const to = dayEnd(f.value);
    return to ? `${col} <= ${bind.add(to)}` : null;
  }
  if (f.op === "on") {
    const to = dayEnd(f.value);
    return to ? `${col} >= ${bind.add(from)} AND ${col} <= ${bind.add(to)}` : null;
  }
  const to = f.value2 ? dayEnd(f.value2) : null;
  return to
    ? `${col} >= ${bind.add(from)} AND ${col} <= ${bind.add(to)}`
    : `${col} >= ${bind.add(from)}`;
}

/** 絞り込みを AND で並べる。読めない条件は黙って飛ばす（他の一覧と同じ） */
function buildWhere(filters: TableState["filters"], bind: Bind): string {
  const parts: string[] = [];
  for (const [key, f] of Object.entries(filters)) {
    const col = COLUMN[key];
    if (!col) continue;
    const sql =
      f.kind === "text"
        ? textWhere(col, f, bind)
        : f.kind === "date"
          ? dateWhere(col, f, bind)
          : null;
    if (sql) parts.push(`(${sql})`);
  }
  return parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "";
}

/**
 * 並べ替え。文字の列は数字を数として読む。
 *
 * **同じ値が並んだときの順番まで決める。**値や更新日には同じものがいくつもあり、
 * そこを決めずに置くと、ページを送るたびに並びが入れ替わって、
 * 同じ行が二度出たり出なかったりする。最後にCAS番号と id を足して決め切る
 * （同じCASに番号が2つ以上あると、CAS番号だけでは決まらない）
 */
function buildOrder(sort: TableState["sort"]): string {
  const tieBreak = `cas_normalized ${NATURAL}`;
  const rule = sort[0];
  const col = rule ? COLUMN[rule.column] : undefined;
  if (!col || col === "cas_normalized") {
    const dir = rule && rule.direction === "desc" ? " DESC" : "";
    return `${tieBreak}${dir}, value ${NATURAL}, id`;
  }
  const dir = rule && rule.direction === "desc" ? " DESC" : "";
  const first = col === "updated_at" ? `updated_at${dir}` : `${col} ${NATURAL}${dir}`;
  return `${first}, ${tieBreak}, id`;
}

export interface MergedRow {
  /** まとめたときは「g:<CAS>:<データソース>」（行が 1 つでなくなるので、実在の id は持たない） */
  id: string;
  source_id: string;
  source_code: string;
  cas_number: string;
  cas_normalized: string;
  /** まとめたときは「(1)-123, (2)-345」のように並べたもの */
  value: string;
  updated_at: Date;
  /** そのデータソースの値が採られているか（優先度の順で、CAS ごとにいちばん上のデータソース） */
  used: boolean;
  /** まとめた行の数（まとめないときは 1） */
  n: number;
  /** 絞り込んだあとの全件数。窓関数で1ページぶんと一緒に取る（数え直さない） */
  total: bigint;
}

/**
 * どの行を出すか（2026-10-17）。
 * - `adopted`（採用）… CAS ごとに優先度のいちばん高いデータソースの行だけ
 * - `all`（すべて）… 並んでいる全部のデータソースの行
 * - `source` … 選んだ 1 つのデータソースの行
 */
export type InventoryRowsMode =
  { kind: "adopted" } | { kind: "all" } | { kind: "source"; sourceId: string };

/**
 * インベントリの該当物質の1ページを引くSQLと、そこに渡す値。
 *
 * **「採用」は CAS ごとに優先度のいちばん高いデータソースを1つ選び、そのデータソースの行は全部残す。**
 * 1つの物質に番号が2つ以上あることがある（化審法番号の (2)-1675 と (2)-1679 など）。
 * 以前は `DISTINCT ON` でCASごとに1行だけ残していて、2つ目以降の番号が合算から消え、
 * 合算の件数がLOLI単独より少なくなっていた（2026-10-16。ENCS で LOLI 96,117 行に対し合算 86,450 行）。
 * 物質の画面の番号（`listNumbersByCas`）と同じ選び方にそろえた。
 *
 * **`group` を立てると、同じ CAS × データソースの行を 1 行にまとめる**（値は「(1)-123, (2)-345」。2026-10-17 指示）。
 * 絞り込みはまとめる前の行に当てる（値で絞ると、当たった値だけが並ぶ）。
 * 「採用」の印は、絞る前の全データソースで決める（選んでいないデータソースに優先度の高い行があれば、採られていない）
 */
export function mergedPageQuery(
  versionId: string,
  inventoryId: string,
  state: TableState,
  opts: { mode?: InventoryRowsMode; group?: boolean } = {},
): { sql: string; values: unknown[] } {
  const mode = opts.mode ?? { kind: "adopted" };
  const bind = new Bind();
  const version = bind.add(versionId);
  const inventory = bind.add(inventoryId);
  const pick =
    mode.kind === "adopted"
      ? "rk = 1"
      : mode.kind === "source"
        ? `source_id = ${bind.add(mode.sourceId)}`
        : "TRUE";
  const order = buildOrder(state.sort);
  const where = buildWhere(state.filters, bind);
  const limit = bind.add(state.pageSize);
  const offset = bind.add((state.page - 1) * state.pageSize);

  const shaped = opts.group
    ? `SELECT ('g:' || cas_normalized || ':' || source_id) AS id, source_id,
              min(source_code) AS source_code, min(cas_number) AS cas_number, cas_normalized,
              string_agg(value, ', ' ORDER BY value ${NATURAL}) AS value,
              max(updated_at) AS updated_at, bool_or(rk = 1) AS used, count(*)::int AS n
       FROM filtered
       GROUP BY cas_normalized, source_id`
    : `SELECT id, source_id, source_code, cas_number, cas_normalized, value, updated_at,
              (rk = 1) AS used, 1 AS n
       FROM filtered`;

  const sql = `
    WITH ranked AS (
      SELECT r.id, r.source_id, s.code AS source_code, r.cas_number, r.cas_normalized, r.value, r.updated_at,
             -- CASごとにデータソースへ順位を付ける。同じデータソースの行は同じ順位になる。
             -- 優先度まで同じデータソースが並んだら（並んでいないもの同士など）、source_id で1つに決める
             rank() OVER (
               PARTITION BY r.cas_normalized
               ORDER BY lvs.priority NULLS LAST, r.source_id
             ) AS rk
      FROM inventory_rows r
      JOIN sources s ON s.id = r.source_id
      -- 優先度は組み合わせの表にある。並んでいないデータソースは最後に回す
      LEFT JOIN link_version_sources lvs
        ON lvs.version_id = r.version_id AND lvs.source_id = r.source_id
      WHERE r.version_id = ${version} AND r.inventory_id = ${inventory}
        -- 無効にしたデータソースの行は無いものとして扱う（並んでいないものは従来どおり最後に回す）
        AND (lvs.enabled IS NULL OR lvs.enabled = true)
    ),
    picked AS (
      SELECT * FROM ranked WHERE ${pick}
    ),
    filtered AS (
      SELECT * FROM picked
      ${where}
    ),
    shaped AS (
      ${shaped}
    )
    SELECT *, count(*) OVER () AS total
    FROM shaped
    ORDER BY ${order}
    LIMIT ${limit} OFFSET ${offset}`;

  return { sql, values: bind.values };
}
