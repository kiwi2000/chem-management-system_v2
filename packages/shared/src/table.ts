/**
 * 一覧（テーブル）の並べ替え・フィルター・ページングの状態。
 * URL に載せる形と型の相互変換をここに集約し、画面とサーバーで同じ解釈になるようにする。
 *
 * URL の形:
 *   sort=code:asc,status:desc      並べ替え（先頭が第1キー）
 *   f.code=contains:pb             列ごとのフィルター
 *   f.status=in:ACTIVE|DISCONTINUED
 *   f.updatedAt=between:2026-01-01|2026-12-31
 *   page=2&size=50
 */

import { z } from "zod";
import type { Messages } from "./i18n/ja";

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

/** 複数の値をまとめて指定する条件（組成のCAS番号など） */
export const LIST_OPERATORS = ["any", "all"] as const;
export type ListOperator = (typeof LIST_OPERATORS)[number];

export type ColumnKind = "text" | "number" | "date" | "enum" | "list";

export type ColumnFilter =
  | { kind: "text"; op: TextOperator; value: string }
  | { kind: "number"; op: NumberOperator; value: string; value2?: string }
  | { kind: "date"; op: DateOperator; value: string; value2?: string }
  | { kind: "enum"; values: string[] }
  /** any=いずれかを含む / all=すべて含む。値は正規化済みのものを並べる */
  | { kind: "list"; op: ListOperator; values: string[] };

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

/**
 * 1ページの件数として受け付ける値。
 * どれを選択肢に出すかは表ごとに決められる（件数の少ない表では 10 を出し、200 は出さない等）が、
 * URL から来た値の検証はここで行うため、出さない値もここには残しておく。
 */
/**
 * 1ページの件数として受け取ってよい範囲。
 *
 * **決まった数の一覧ではなく、幅で見る。**
 * 一覧で持っていたときは、そこに無い数（30 など）が黙って既定に落ち、
 * 選んだのに効かない、という分かりにくい不具合になった。
 *
 * 下限は1。少ない数が読みやすい場面もあるので、こちらでは決めない
 */
export const PAGE_SIZE_MIN = 1;
export const PAGE_SIZE_MAX = 500;

/** 選択肢として出す既定。人ごとに変えられる（`preferredPageSizes`） */
export const DEFAULT_PAGE_SIZE_OPTIONS = [15, 25, 50, 100, 200] as const;
/**
 * 何も決めていない人の既定。
 * **画面に収まる数から始める。**多すぎると、下まで見るのに縦に長く送ることになる。
 * 増やしたい人は個人設定で変えられる
 */
export const DEFAULT_PAGE_SIZE = 15;

/** 1ページの件数として通る数か */
export function isPageSize(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= PAGE_SIZE_MIN && n <= PAGE_SIZE_MAX;
}

export function emptyTableState(sort: SortRule[] = []): TableState {
  return { sort, filters: {}, page: 1, pageSize: DEFAULT_PAGE_SIZE };
}

/** フィルターが1つでも掛かっているか（「フィルター中」の表示に使う） */
export function activeFilterCount(state: TableState): number {
  return Object.keys(state.filters).length;
}

const FILTER_PREFIX = "f.";

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

/** その列の種類として解釈できるフィルターだけを受け取る（不正なURLは黙って無視する） */
function parseFilter(kind: ColumnKind, raw: string): ColumnFilter | null {
  const [op, rest] = splitOnce(raw, ":");
  if (kind === "list") {
    if (!(LIST_OPERATORS as readonly string[]).includes(op)) return null;
    const values = rest.split("|").filter((v) => v !== "");
    return values.length > 0 ? { kind: "list", op: op as ListOperator, values } : null;
  }
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
  if (f.kind === "list") return `${f.op}:${f.values.join("|")}`;
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
  const pageSize = isPageSize(sizeRaw) ? sizeRaw : fallback.pageSize;

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
  /*
    件数だけは**共通の既定**と比べる。呼ぶ側の既定と比べると、
    画面が「200件出す」つもりでも `size` が省かれ、
    受け取る側は共通の既定で数えてしまう（実際にそうなっていた）。
    並べ替えと絞り込みは、画面ごとの既定と比べてよい（URLを短く保つため）
  */
  if (state.pageSize !== DEFAULT_PAGE_SIZE) params.set("size", String(state.pageSize));

  return params;
}

/**
 * 保存したフィルター。
 * 条件そのものはクエリ文字列で持つので、列構成が変わっても
 * 解釈できるものだけが効く（parseTableState が不正な条件を捨てる）。
 */
export const savedFilterSchema = (m: Messages) =>
  z.object({
    tableKey: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1, m.validation.required).max(100, m.validation.tooLong(100)),
    query: z.string().max(2000, m.validation.tooLong(2000)),
    shared: z.boolean(),
  });

export type SavedFilterInput = z.infer<ReturnType<typeof savedFilterSchema>>;

/**
 * まとめて入力された値を1件ずつに分ける。
 * 数字とハイフン以外はすべて区切りとみなすので、改行・カンマ・空白のどれで区切ってもよい。
 * CAS番号のように「形が数字とハイフンだけ」の値に使う。
 */
export function splitNumericTokens(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[^0-9-]+/)) {
    const v = token.replace(/^-+|-+$/g, "");
    if (v === "" || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
