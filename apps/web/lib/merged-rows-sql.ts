import type { ColumnFilter, TableState } from "@chem/shared";
import { normalizeCas } from "@chem/shared";

/**
 * 合算（データソースを名指ししないとき）の1ページを、データベース側で解くための組み立て。
 *
 * **アプリに全行を運ばない。**13万行を運ぶだけで0.7秒かかっていた。
 * CASごとに優先度のいちばん高い行を1つ残す `DISTINCT ON` はデータベースの得意な形で、
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
  if (f.op === "equals") return `${col} = ${bind.add(raw)}`;

  const esc = escapeLike(raw);
  const pattern = f.op === "startsWith" ? `${esc}%` : f.op === "endsWith" ? `%${esc}` : `%${esc}%`;
  // 「値」は大文字小文字を区別しない（table-query.ts の caseInsensitive と同じ）
  const op = col === "value" ? "ILIKE" : "LIKE";
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
 * 同じ行が二度出たり出なかったりする。最後にCAS番号を足して決め切る
 */
function buildOrder(sort: TableState["sort"]): string {
  const tieBreak = `cas_normalized ${NATURAL}`;
  const rule = sort[0];
  const col = rule ? COLUMN[rule.column] : undefined;
  if (!col || col === "cas_normalized") {
    const dir = rule && rule.direction === "desc" ? " DESC" : "";
    return `${tieBreak}${dir}`;
  }
  const dir = rule && rule.direction === "desc" ? " DESC" : "";
  const first = col === "updated_at" ? `updated_at${dir}` : `${col} ${NATURAL}${dir}`;
  return `${first}, ${tieBreak}`;
}

export interface MergedRow {
  id: string;
  source_id: string;
  cas_number: string;
  cas_normalized: string;
  value: string;
  updated_at: Date;
  /** 絞り込んだあとの全件数。窓関数で1ページぶんと一緒に取る（数え直さない） */
  total: bigint;
}

/**
 * 合算の1ページを引くSQLと、そこに渡す値。
 *
 * `DISTINCT ON` の並びは外側の並べ替えと同じにしておく。そうするとデータベースが
 * 並べ直さずに済み、最後のページでも最初のページと同じ速さで返る（実測でどちらも0.29秒）。
 */
export function mergedPageQuery(
  versionId: string,
  inventoryId: string,
  state: TableState,
): { sql: string; values: unknown[] } {
  const bind = new Bind();
  const version = bind.add(versionId);
  const inventory = bind.add(inventoryId);
  const order = buildOrder(state.sort);
  const where = buildWhere(state.filters, bind);
  const limit = bind.add(state.pageSize);
  const offset = bind.add((state.page - 1) * state.pageSize);

  const sql = `
    WITH winner AS (
      SELECT DISTINCT ON (r.cas_normalized ${NATURAL})
             r.id, r.source_id, r.cas_number, r.cas_normalized, r.value, r.updated_at
      FROM inventory_rows r
      -- 優先度は組み合わせの表にある。並んでいないデータソースは最後に回す
      LEFT JOIN link_version_sources lvs
        ON lvs.version_id = r.version_id AND lvs.source_id = r.source_id
      WHERE r.version_id = ${version} AND r.inventory_id = ${inventory}
      -- 優先度まで同じ行があるときの順番も決めておく（どれが残るかを毎回同じにする）
      ORDER BY r.cas_normalized ${NATURAL}, lvs.priority NULLS LAST, r.value, r.id
    )
    SELECT *, count(*) OVER () AS total
    FROM winner
    ${where}
    ORDER BY ${order}
    LIMIT ${limit} OFFSET ${offset}`;

  return { sql, values: bind.values };
}
