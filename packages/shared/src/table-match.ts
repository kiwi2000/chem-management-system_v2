import type { ColumnFilter } from "./table";

/**
 * すでに手元にある行を、表の絞り込み条件で選り分ける。
 *
 * **データベースへ問い合わせ直さない表のためのもの。**
 * 対象CASのように「1回引いたら全部が手元にある」表は、
 * 絞るたびに引き直す意味がない。条件の書き方（`ColumnFilter`）は
 * 問い合わせる表とまったく同じにして、画面の操作を揃える。
 *
 * 値はすべて**文字として**見る。数や日付を持つ表で使うときは、
 * 呼ぶ側が比べられる形にしてから渡す。
 */
export function matchesFilter(raw: string | null | undefined, f: ColumnFilter): boolean {
  const cell = raw ?? "";

  switch (f.kind) {
    case "text": {
      // 大文字小文字は区別しない。CAS番号も名前も、打った形で当たってほしい
      const v = f.value.trim().toLowerCase();
      const c = cell.toLowerCase();
      switch (f.op) {
        case "empty":
          return cell === "";
        case "notEmpty":
          return cell !== "";
        case "equals":
          return v === "" ? true : c === v;
        case "startsWith":
          return v === "" ? true : c.startsWith(v);
        case "endsWith":
          return v === "" ? true : c.endsWith(v);
        default:
          // 打ちかけの空欄では絞らない。1文字打つ前に全部消えると直しようがない
          return v === "" ? true : c.includes(v);
      }
    }

    case "enum":
      // 何も選んでいなければ絞らない
      return f.values.length === 0 || f.values.includes(cell);

    case "list": {
      if (f.values.length === 0) return true;
      const parts = cell
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      return f.op === "all"
        ? f.values.every((v) => parts.includes(v))
        : f.values.some((v) => parts.includes(v));
    }

    case "number": {
      if (f.op === "empty") return cell === "";
      if (f.op === "notEmpty") return cell !== "";
      const n = Number(cell);
      if (cell === "" || Number.isNaN(n)) return false;
      const a = Number(f.value);
      const b = Number(f.value2 ?? "");
      switch (f.op) {
        case "eq":
          return Number.isNaN(a) ? true : n === a;
        case "gte":
          return Number.isNaN(a) ? true : n >= a;
        case "lte":
          return Number.isNaN(a) ? true : n <= a;
        case "between":
          return (Number.isNaN(a) || n >= a) && (Number.isNaN(b) || n <= b);
        default:
          return true;
      }
    }

    case "date": {
      if (f.op === "empty") return cell === "";
      if (f.op === "notEmpty") return cell !== "";
      // 日付は YYYY-MM-DD の並びなので、文字のまま比べられる
      const d = cell.slice(0, 10);
      if (d === "") return false;
      const a = f.value;
      const b = f.value2 ?? "";
      switch (f.op) {
        case "on":
          return a === "" ? true : d === a;
        case "from":
          return a === "" ? true : d >= a;
        case "to":
          return a === "" ? true : d <= a;
        case "between":
          return (a === "" || d >= a) && (b === "" || d <= b);
        default:
          return true;
      }
    }

    default:
      return true;
  }
}

/** 条件をすべて満たす行だけを残す */
export function applyFilters<T>(
  rows: T[],
  filters: Record<string, ColumnFilter>,
  valueOf: (row: T, column: string) => string | null | undefined,
): T[] {
  const entries = Object.entries(filters);
  if (entries.length === 0) return rows;
  return rows.filter((r) => entries.every(([col, f]) => matchesFilter(valueOf(r, col), f)));
}
