/**
 * 一覧（テーブル）の並べ替え・絞り込み・ページングの状態。
 * URL に載せる形と型の相互変換をここに集約し、画面とサーバーで同じ解釈になるようにする。
 *
 * URL の形:
 *   sort=code:asc,status:desc      並べ替え（先頭が第1キー）
 *   f.code=contains:pb             列ごとの絞り込み
 *   f.status=in:ACTIVE|DISCONTINUED
 *   f.updatedAt=between:2026-01-01|2026-12-31
 *   page=2&size=50
 */

export const TEXT_OPERATORS = [
  "contains",
  "startsWith",
  "endsWith",
  "equals",
  "empty",
  "notEmpty",
] as const;
export type TextOperator = (typeof TEXT_OPERATORS)[number];

export const NUMBER_OPERATORS = ["eq", "gte", "lte", "between", "empty", "notEmpty"] as const;
export type NumberOperator = (typeof NUMBER_OPERATORS)[number];

export const DATE_OPERATORS = ["on", "from", "to", "between", "empty", "notEmpty"] as const;
export type DateOperator = (typeof DATE_OPERATORS)[number];

/** 値を必要としない演算子（「空白」「空白でない」） */
export const VALUELESS_OPERATORS = ["empty", "notEmpty"] as const;
export function needsValue(op: string): boolean {
  return !(VALUELESS_OPERATORS as readonly string[]).includes(op);
}
export function needsSecondValue(op: string): boolean {
  return op === "between";
}

export type ColumnKind = "text" | "number" | "date" | "enum";

export type ColumnFilter =
  | { kind: "text"; op: TextOperator; value: string }
  | { kind: "number"; op: NumberOperator; value: string; value2?: string }
  | { kind: "date"; op: DateOperator; value: string; value2?: string }
  | { kind: "enum"; values: string[] };

export type SortDirection = "asc" | "desc";
export interface SortRule {
  column: string;
  direction: SortDirection;
}

export interface TableState {
  sort: SortRule[];
  filters: Record<string, ColumnFilter>;
  page: number;
  pageSize: number;
}

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 50;

export function emptyTableState(sort: SortRule[] = []): TableState {
  return { sort, filters: {}, page: 1, pageSize: DEFAULT_PAGE_SIZE };
}

/** 絞り込みが1つでも掛かっているか（「絞り込み中」の表示に使う） */
export function activeFilterCount(state: TableState): number {
  return Object.keys(state.filters).length;
}

const FILTER_PREFIX = "f.";

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

/** その列の種類として解釈できる絞り込みだけを受け取る（不正なURLは黙って無視する） */
function parseFilter(kind: ColumnKind, raw: string): ColumnFilter | null {
  const [op, rest] = splitOnce(raw, ":");
  if (kind === "enum") {
    if (op !== "in") return null;
    const values = rest.split("|").filter((v) => v !== "");
    return values.length > 0 ? { kind: "enum", values } : null;
  }
  const [value, value2] = splitOnce(rest, "|");
  if (kind === "text") {
    if (!(TEXT_OPERATORS as readonly string[]).includes(op)) return null;
    if (needsValue(op) && value === "") return null;
    return { kind: "text", op: op as TextOperator, value };
  }
  // 2つ目の値は「範囲」のときだけ持つ（そうしないと往復で空文字が付いてしまう）
  const second = needsSecondValue(op) && value2 !== "" ? value2 : undefined;
  if (kind === "number") {
    if (!(NUMBER_OPERATORS as readonly string[]).includes(op)) return null;
    if (needsValue(op) && value === "") return null;
    return { kind: "number", op: op as NumberOperator, value, value2: second };
  }
  if (!(DATE_OPERATORS as readonly string[]).includes(op)) return null;
  if (needsValue(op) && value === "") return null;
  return { kind: "date", op: op as DateOperator, value, value2: second };
}

function serializeFilter(f: ColumnFilter): string {
  if (f.kind === "enum") return `in:${f.values.join("|")}`;
  if (!needsValue(f.op)) return `${f.op}:`;
  if (f.kind !== "text" && needsSecondValue(f.op)) return `${f.op}:${f.value}|${f.value2 ?? ""}`;
  return `${f.op}:${f.value}`;
}

/** URL のクエリから状態を作る。列の定義に無いキーや壊れた値は無視する */
export function parseTableState(
  params: URLSearchParams,
  columns: { key: string; kind: ColumnKind }[],
  fallback: TableState,
): TableState {
  const byKey = new Map(columns.map((c) => [c.key, c.kind]));

  const sortRaw = params.get("sort");
  const sort: SortRule[] = [];
  if (sortRaw !== null) {
    for (const part of sortRaw.split(",")) {
      const [column, dir] = splitOnce(part, ":");
      if (!byKey.has(column)) continue;
      if (sort.some((s) => s.column === column)) continue;
      sort.push({ column, direction: dir === "desc" ? "desc" : "asc" });
    }
  }

  const filters: Record<string, ColumnFilter> = {};
  for (const [name, raw] of params.entries()) {
    if (!name.startsWith(FILTER_PREFIX)) continue;
    const key = name.slice(FILTER_PREFIX.length);
    const kind = byKey.get(key);
    if (!kind) continue;
    const parsed = parseFilter(kind, raw);
    if (parsed) filters[key] = parsed;
  }

  const page = Math.max(1, Number(params.get("page") ?? "") || 1);
  const sizeRaw = Number(params.get("size") ?? "");
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(sizeRaw)
    ? sizeRaw
    : fallback.pageSize;

  return {
    sort: sortRaw !== null ? sort : fallback.sort,
    filters,
    page,
    pageSize,
  };
}

/** 状態を URL のクエリにする。既定と同じ項目は載せない（URLを短く保つ） */
export function serializeTableState(state: TableState, fallback: TableState): URLSearchParams {
  const params = new URLSearchParams();

  const sortStr = state.sort.map((s) => `${s.column}:${s.direction}`).join(",");
  const fallbackSort = fallback.sort.map((s) => `${s.column}:${s.direction}`).join(",");
  if (sortStr !== fallbackSort) params.set("sort", sortStr);

  for (const [key, f] of Object.entries(state.filters)) {
    params.set(`${FILTER_PREFIX}${key}`, serializeFilter(f));
  }
  if (state.page > 1) params.set("page", String(state.page));
  if (state.pageSize !== fallback.pageSize) params.set("size", String(state.pageSize));

  return params;
}
