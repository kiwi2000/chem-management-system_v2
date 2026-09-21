import { applyFilters, emptyTableState, type ColumnKind, type TableState } from "@chem/shared";
import type { PrtrSummaryRowDto } from "@/lib/types";

/**
 * PRTR 集計の表の列。集計は DB に無く、そのつど計算した行が全部手元にあるので、
 * 絞り込み・並べ替え・ページ送りも**手元で**行う（対象CASの表と同じ作り）。
 * 条件の書き方はほかの表とまったく同じにして、画面の操作を揃える
 */
export const PRTR_SUMMARY_COLUMNS = [
  { key: "officialNumber", kind: "text" },
  { key: "name", kind: "text" },
  { key: "kind", kind: "enum" },
  { key: "productCount", kind: "number" },
  { key: "handledKg", kind: "number" },
  { key: "shippedKg", kind: "number" },
  { key: "releaseKg", kind: "number" },
  { key: "needsReport", kind: "enum" },
] as const satisfies { key: string; kind: ColumnKind }[];

export const PRTR_SUMMARY_DEFAULT_STATE = emptyTableState([
  { column: "officialNumber", direction: "asc" },
]);

const NUMBER_COLUMNS = new Set(
  PRTR_SUMMARY_COLUMNS.filter((c) => c.kind === "number").map((c) => c.key as string),
);

/** 絞り込みと並べ替えで見る値。画面に出ているものと同じにする */
export function summaryCellOf(r: PrtrSummaryRowDto, column: string): string {
  switch (column) {
    case "officialNumber":
      return r.officialNumber ?? "";
    case "name":
      // 画面は言語で出し分けるが、絞るときはどの名前でも当たってほしい
      return [r.nameJa, r.nameEn, r.nameOriginal].filter(Boolean).join(" ");
    case "kind":
      return r.specific ? "SC1" : "C1";
    case "productCount":
      return String(r.productCount);
    case "handledKg":
      return r.handledKg;
    case "shippedKg":
      return r.shippedKg ?? "";
    case "releaseKg":
      return r.releaseKg ?? "";
    case "needsReport":
      return r.needsReport ? "yes" : "no";
    default:
      return "";
  }
}

/** 数の列は数として比べる。空は最後 */
function compareCell(column: string, a: string, b: string): number {
  if (NUMBER_COLUMNS.has(column)) {
    if (a === "" || b === "") return a === b ? 0 : a === "" ? 1 : -1;
    return Number(a) - Number(b);
  }
  return a.localeCompare(b, "ja", { numeric: true });
}

/** 絞り込み → 複数列の並べ替え → ページ送り */
export function pageSummaryRows(
  rows: PrtrSummaryRowDto[],
  state: TableState,
): { items: PrtrSummaryRowDto[]; total: number } {
  const filtered = applyFilters(rows, state.filters, summaryCellOf);
  const sorted =
    state.sort.length === 0
      ? filtered
      : [...filtered].sort((a, b) => {
          for (const s of state.sort) {
            const d = compareCell(s.column, summaryCellOf(a, s.column), summaryCellOf(b, s.column));
            if (d !== 0) return s.direction === "desc" ? -d : d;
          }
          return 0;
        });
  const from = (state.page - 1) * state.pageSize;
  return { items: sorted.slice(from, from + state.pageSize), total: sorted.length };
}
