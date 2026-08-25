import type { ColumnFilter, ColumnKind, SortRule, TableState } from "@chem/shared";

/**
 * 一覧のフィルター・並べ替えを Prisma の条件に変換する。
 * すべての一覧画面で同じ挙動になるよう、ここに集約する。
 */

export interface QueryColumn {
  key: string;
  kind: ColumnKind;
  /** Prisma のフィールド名（画面のキーと違ってよい） */
  field: string;
  /** フィルター前に値を正規化する（コード・CAS番号など） */
  normalize?: (raw: string) => string;
  /** 大文字小文字を区別せずに突合する（正規化列には付けない） */
  caseInsensitive?: boolean;
  /** 並べ替えに使えるか（既定は可） */
  sortable?: boolean;
  /**
   * 子テーブルの項目でフィルターする場合の関連名（例: 官報公示整理番号）。
   * 「1件でも条件に合う行があれば該当」として扱う。
   * 並べ替えには使えない（Prisma が1対多の項目で並べ替えできないため）。
   */
  relation?: string;
  /** はい/いいえ の列。選択肢の "true" / "false" を真偽値に直して渡す */
  booleanEnum?: boolean;
  /**
   * kind="list" の列で、値を探しに行く関連の道順（例: 組成のCAS番号なら
   * ["compositionLines", "substance"]）。最後に `field` で突き合わせる。
   */
  relationPath?: string[];
  /**
   * 1対1の関連をたどって絞る（法令 → 国 → 地域 のように）。
   * `relation` は「1件でも合う行があるか」を見る1対多用なので、
   * 1対1に使うと Prisma が受け付けない。
   */
  nested?: string;
  /**
   * 共通の組み立てに乗らない条件を、自分で作る。
   *
   * 「該当した区分が1つでもあるか」のように、**関連の有無と行の中身を
   * 組み合わせて見る**条件は、列と値の対応だけでは書けない。
   * これを返した場合、`field` などの共通処理はすべて飛ばす。
   *
   * 何も絞らないときは `null` を返す。
   */
  custom?: (filter: ColumnFilter) => Where | null;
}

/**
 * 関連をたどって「この値を持つ行が1件でもあるか」を作る。
 * 例: { compositionLines: { some: { substance: { casNormalized: "7439-92-1" } } } }
 */
function someAlong(path: string[], field: string, value: string): Where {
  let inner: Where = { [field]: value };
  for (let i = path.length - 1; i >= 0; i--) {
    const step = path[i] as string;
    // 先頭は1対多（some）、その先は1対1（そのまま入れ子）
    inner = i === 0 ? { [step]: { some: inner } } : { [step]: inner };
  }
  return inner;
}

/**
 * 複数の値をまとめて指定する条件。
 * all=すべて含む（値ごとに条件を作って AND）／ any=いずれかを含む（OR）。
 */
function listCondition(col: QueryColumn, f: Extract<ColumnFilter, { kind: "list" }>): Where | null {
  const values = col.normalize ? f.values.map((v) => col.normalize!(v)) : f.values;
  const uniq = [...new Set(values.filter((v) => v !== ""))];
  if (uniq.length === 0) return null;
  const path = col.relationPath ?? [];
  const each = uniq.map((v) => someAlong(path, col.field, v));
  return f.op === "all" ? { AND: each } : { OR: each };
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

/**
 * はい/いいえ の列。
 * Prisma の Boolean 型には `in` が無いので、選択肢を真偽値そのものにほどく。
 * 両方選ばれている場合はフィルターしないのと同じ（列は null を取らないため）。
 */
function boolCondition(col: QueryColumn, values: string[]): Where | null {
  const picked = [...new Set(values.map((v) => v === "true"))];
  const only = picked[0];
  if (only === undefined || picked.length > 1) return null;
  return { [col.field]: only };
}

/** フィルターを AND で組み立てる。解釈できない条件は無視する */
export function buildWhere(columns: QueryColumn[], filters: TableState["filters"]): Where {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const conditions: Where[] = [];

  for (const [key, f] of Object.entries(filters)) {
    const col = byKey.get(key);
    if (!col || col.kind !== f.kind) continue;

    // 自前で組み立てる列は、共通処理に一切乗せない
    if (col.custom) {
      const own = col.custom(f);
      if (own) conditions.push(own);
      continue;
    }

    if (f.kind === "list") {
      // 関連をたどる条件は、この時点で完成している（relation の共通処理には乗せない）
      const listCond = listCondition(col, f);
      if (listCond) conditions.push(listCond);
      continue;
    }

    const cond =
      f.kind === "text"
        ? textCondition(col, f)
        : f.kind === "number"
          ? numberCondition(col, f)
          : f.kind === "date"
            ? dateCondition(col, f)
            : f.values.length === 0
              ? null
              : col.booleanEnum
                ? boolCondition(col, f.values)
                : { [col.field]: { in: f.values } };
    if (!cond) continue;
    // 1対1の関連は、そのまま入れ子にする
    if (col.nested) {
      conditions.push({ [col.nested]: cond });
      continue;
    }
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
