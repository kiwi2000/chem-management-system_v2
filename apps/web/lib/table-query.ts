import type { ColumnFilter, ColumnKind, SortRule, TableState } from "@chem/shared";

/**
 * 一覧の絞り込み・並べ替えを Prisma の条件に変換する。
 * すべての一覧画面で同じ挙動になるよう、ここに集約する。
 */

export interface QueryColumn {
  key: string;
  kind: ColumnKind;
  /** Prisma のフィールド名（画面のキーと違ってよい） */
  field: string;
  /** 絞り込み前に値を正規化する（コード・CAS番号など） */
  normalize?: (raw: string) => string;
  /** 大文字小文字を区別せずに突合する（正規化列には付けない） */
  caseInsensitive?: boolean;
  /** 並べ替えに使えるか（既定は可） */
  sortable?: boolean;
  /**
   * 子テーブルの項目で絞り込む場合の関連名（例: 官報公示整理番号）。
   * 「1件でも条件に合う行があれば該当」として扱う。
   * 並べ替えには使えない（Prisma が1対多の項目で並べ替えできないため）。
   */
  relation?: string;
  /** はい/いいえ の列。選択肢の "true" / "false" を真偽値に直して渡す */
  booleanEnum?: boolean;
}

type Where = Record<string, unknown>;

function textCondition(col: QueryColumn, f: Extract<ColumnFilter, { kind: "text" }>): Where | null {
  if (f.op === "empty") return { OR: [{ [col.field]: null }, { [col.field]: "" }] };
  if (f.op === "notEmpty")
    return { AND: [{ [col.field]: { not: null } }, { [col.field]: { not: "" } }] };

  const value = col.normalize ? col.normalize(f.value) : f.value;
  const mode = col.caseInsensitive ? { mode: "insensitive" as const } : {};
  const op =
    f.op === "startsWith"
      ? "startsWith"
      : f.op === "endsWith"
        ? "endsWith"
        : f.op === "equals"
          ? "equals"
          : "contains";
  return { [col.field]: { [op]: value, ...mode } };
}

function numberCondition(
  col: QueryColumn,
  f: Extract<ColumnFilter, { kind: "number" }>,
): Where | null {
  if (f.op === "empty") return { [col.field]: null };
  if (f.op === "notEmpty") return { [col.field]: { not: null } };

  const a = Number(f.value);
  if (Number.isNaN(a)) return null;
  if (f.op === "eq") return { [col.field]: a };
  if (f.op === "gte") return { [col.field]: { gte: a } };
  if (f.op === "lte") return { [col.field]: { lte: a } };

  const b = Number(f.value2);
  if (Number.isNaN(b)) return { [col.field]: { gte: a } };
  return { [col.field]: { gte: Math.min(a, b), lte: Math.max(a, b) } };
}

/** 日付は「その日いっぱい」を含める（時刻を持つ列でも直感どおりに絞れるように） */
function dayStart(v: string): Date | null {
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function dayEnd(v: string): Date | null {
  const d = new Date(`${v}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateCondition(col: QueryColumn, f: Extract<ColumnFilter, { kind: "date" }>): Where | null {
  if (f.op === "empty") return { [col.field]: null };
  if (f.op === "notEmpty") return { [col.field]: { not: null } };

  const from = dayStart(f.value);
  if (!from) return null;
  if (f.op === "from") return { [col.field]: { gte: from } };
  if (f.op === "to") {
    const to = dayEnd(f.value);
    return to ? { [col.field]: { lte: to } } : null;
  }
  if (f.op === "on") {
    const to = dayEnd(f.value);
    return to ? { [col.field]: { gte: from, lte: to } } : null;
  }
  const to = f.value2 ? dayEnd(f.value2) : null;
  return to ? { [col.field]: { gte: from, lte: to } } : { [col.field]: { gte: from } };
}

/** 絞り込み条件を AND で組み立てる。解釈できない条件は無視する */
export function buildWhere(columns: QueryColumn[], filters: TableState["filters"]): Where {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const conditions: Where[] = [];

  for (const [key, f] of Object.entries(filters)) {
    const col = byKey.get(key);
    if (!col || col.kind !== f.kind) continue;

    const cond =
      f.kind === "text"
        ? textCondition(col, f)
        : f.kind === "number"
          ? numberCondition(col, f)
          : f.kind === "date"
            ? dateCondition(col, f)
            : f.values.length > 0
              ? {
                  [col.field]: col.booleanEnum
                    ? { in: f.values.map((v) => v === "true") }
                    : { in: f.values },
                }
              : null;
    if (!cond) continue;
    if (!col.relation) {
      conditions.push(cond);
      continue;
    }
    // 子テーブルの「空白」は列の値ではなく「行が1件も無い」を意味する
    if (f.kind === "text" && f.op === "empty") {
      conditions.push({ [col.relation]: { none: {} } });
    } else if (f.kind === "text" && f.op === "notEmpty") {
      conditions.push({ [col.relation]: { some: {} } });
    } else {
      // それ以外は「1件でも条件に合う行があれば該当」
      conditions.push({ [col.relation]: { some: cond } });
    }
  }

  return conditions.length > 0 ? { AND: conditions } : {};
}

/**
 * 並べ替え。指定が無ければ既定の並びを使う。
 * 最後に必ず一意な列を足して、ページをまたいだときに順序がぶれないようにする。
 */
export function buildOrderBy(
  columns: QueryColumn[],
  sort: SortRule[],
  tieBreaker: Record<string, "asc" | "desc">,
): Record<string, "asc" | "desc">[] {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const order: Record<string, "asc" | "desc">[] = [];

  for (const rule of sort) {
    const col = byKey.get(rule.column);
    if (!col || col.sortable === false || col.relation) continue;
    order.push({ [col.field]: rule.direction });
  }

  const tieField = Object.keys(tieBreaker)[0];
  if (tieField !== undefined && !order.some((o) => Object.keys(o)[0] === tieField)) {
    order.push(tieBreaker);
  }
  return order;
}
