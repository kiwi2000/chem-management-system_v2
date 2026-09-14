import type { ImportAction } from "@prisma/client";

/**
 * 取り込み（決定 0011）の中で使う型。
 *
 * 流れ: ファイル → 読み取り（reader）→ 本体と突き合わせて一時領域の行（StagedRow）→ 画面で確認 → 反映（apply）。
 * 一時領域の行は ImportRow（DB）に入れる。payload に書き込みに要る値、diff に「いまの値 → 新しい値」を持つ
 */

/** 一時領域の行の種類（ImportRow.kind） */
export type RowKind =
  | "source"
  | "version"
  | "law"
  | "category"
  | "class"
  | "substance"
  | "link"
  | "product"
  | "composition"
  | "substance_master";

/** 項目ごとの差 */
export type Diff = Record<string, { current: unknown; next: unknown }>;

export interface StagedRow {
  kind: RowKind;
  /** コードの道筋（JP-CSCL/CAT/CLASS/SUB）や製品コード。人が読む鍵 */
  keyPath: string;
  /** 人が読む名前 */
  label: string;
  action: ImportAction;
  /** 反映するか（CONFLICT と ERROR は false） */
  apply: boolean;
  diff?: Diff;
  /** 書き込みに要る値（読み取った行そのもの。種類ごとに形が違う） */
  payload: unknown;
  message?: string;
}

/** 読み取りの結果の要約（ImportJob.summary に入れる） */
export interface StageSummary {
  kind: string;
  fileName: string;
  rows: number;
  counts: Record<string, Partial<Record<ImportAction, number>>>;
  /** 読めなかった行の数 */
  errors: number;
  /** 読み取りで気づいたこと（表記ゆれなど） */
  notes: string[];
}

/** 反映の結果 */
export interface ApplySummary {
  applied: Record<string, number>;
  skipped: number;
  failed: number;
  ms: number;
}

/**
 * 取り込みで書いた行の「誰が更新したか」の印。
 * 人が画面で直すと人の ID に置き換わるので、次の取り込みで「前回の取り込みのあとに人が触った行」を見分けられる
 */
export const IMPORT_ACTOR_PREFIX = "import:";
export function importActor(jobId: string): string {
  return `${IMPORT_ACTOR_PREFIX}${jobId}`;
}
export function editedByHuman(updatedBy: string | null | undefined): boolean {
  return !!updatedBy && !updatedBy.startsWith(IMPORT_ACTOR_PREFIX);
}

/** 差を取る（文字列にそろえて比べる。Decimal・日付・null を同じ土俵に乗せる） */
export function diffFields(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
  fields: readonly string[],
): Diff {
  const d: Diff = {};
  for (const f of fields) {
    const a = norm(current[f]);
    const b = norm(next[f]);
    if (a !== b) d[f] = { current: current[f] ?? null, next: next[f] ?? null };
  }
  return d;
}

function norm(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v !== null && "toString" in v) {
    // Prisma の Decimal
    const s = String(v);
    return isFinite(Number(s)) ? String(Number(s)) : s;
  }
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v).trim();
  return isFinite(Number(s)) && s !== "" ? String(Number(s)) : s;
}
