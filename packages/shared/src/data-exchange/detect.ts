/**
 * 受け取ったファイルの種類を決める（決定 0011 §4）。
 *   1. 拡張子で一次判別。.json（zip の中の .json を含む）は当方のデータセット、
 *      .tsv / .txt / .csv は利用者の表
 *   2. 中身でも確かめる。JSON は形式の印、表は 1 行目の列名
 * 判別の結果は下見の先頭に出し、利用者が確かめてから取り込む。
 * DB には触らない（純粋な関数。テストは detect.test.ts）
 */
import { isSnapshotLike } from "./snapshot";
import { TABLE_COLUMNS, mapHeader, type TableKind } from "./columns";
import { parseTable } from "./tsv";

export type ImportFileKind = "DATA_SET" | TableKind;

export type Detection =
  | { ok: true; kind: ImportFileKind; delimiter?: "\t" | ","; header?: string[]; rowCount?: number }
  | {
      ok: false;
      reason: "extension" | "not_data_set" | "missing_columns" | "empty" | "unreadable";
      missing?: string[];
      header?: string[];
    };

const TABLE_EXT = new Set(["tsv", "txt", "csv"]);
const JSON_EXT = new Set(["json"]);

export function fileExtension(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
}

/**
 * 表の 1 行目から種類を決める。
 * 規制リスト（法律・規制区分・法文物質名・CAS）／製品と組成（製品コード）／物質（物質コード・名称）の順に試し、
 * 必須の列がそろう最初のものを採る。どれにも当てはまらなければ、いちばん近い種類の足りない列を返す
 */
export function detectTableKind(
  header: string[],
): { ok: true; kind: TableKind } | { ok: false; missing: string[]; nearest: TableKind } {
  const order: TableKind[] = ["REGULATION_LIST", "PRODUCTS", "SUBSTANCES"];
  let best: { kind: TableKind; missing: string[]; matched: number } | null = null;
  for (const kind of order) {
    const m = mapHeader(header, TABLE_COLUMNS[kind]);
    if (m.missing.length === 0) return { ok: true, kind };
    const matched = Object.keys(m.index).length;
    if (!best || matched > best.matched) best = { kind, missing: m.missing, matched };
  }
  return { ok: false, missing: best!.missing, nearest: best!.kind };
}

/**
 * ファイル名と中身（先頭。表なら 1 行目が入っていれば足りる）から種類を決める。
 * zip は呼ぶ側で中の 1 ファイルを取り出してから渡す
 */
export function detectImportFile(fileName: string, text: string): Detection {
  const ext = fileExtension(fileName);
  if (JSON_EXT.has(ext)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    if (!isSnapshotLike(parsed)) return { ok: false, reason: "not_data_set" };
    return { ok: true, kind: "DATA_SET" };
  }
  if (!TABLE_EXT.has(ext)) return { ok: false, reason: "extension" };
  const table = parseTable(text);
  if (table.header.length === 0) return { ok: false, reason: "empty" };
  const d = detectTableKind(table.header);
  if (!d.ok)
    return { ok: false, reason: "missing_columns", missing: d.missing, header: table.header };
  return {
    ok: true,
    kind: d.kind,
    delimiter: table.delimiter,
    header: table.header,
    rowCount: table.rows.length,
  };
}
