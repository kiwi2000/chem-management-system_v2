import type { ImportAction, PublishState } from "@prisma/client";
import { canOn, type Actor } from "@/lib/authz";
import { editableInState } from "@/lib/product-service";

/**
 * 取り込み（決定 0011）の中で使う型。
 *
 * 流れ: ファイル → 読み取り（reader）→ 本体と突き合わせて一時領域の行（StagedRow）→ 画面で確認 → 反映（apply）。
 * 一時領域の行は ImportRow（DB）に入れる。payload に書き込みに要る値、diff に「いまの値 → 新しい値」を持つ
 */

/** 一時領域の行の種類（ImportRow.kind） */
export type RowKind =
  | "region"
  | "country"
  | "element"
  | "factor"
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

/**
 * 製品・物質の取り込みで、取り込む人と所属先の決め方（S31 仕様 7 章）
 */
export interface StageContext {
  actor: Actor;
  /** fixed = 画面で選んだ所属先、column = TSV の所属先の列 */
  mode: "fixed" | "column";
  /** fixed のときの所属先（管理グループの id） */
  fixedOwner: string | null;
  /** 所属先にできる管理グループ（システム管理グループを除く全部） */
  owners: { id: string; code: string }[];
}

/**
 * 1 行の所属先を決める。決められないときは理由の文を返す。
 * - 新しく作る行: fixed は画面で選んだ所属先、column は列のコード。どちらも「編集」の印が要る
 * - 既にある行: 今の所属先に「編集」の印が要る。column で別のコードなら移す（移す先にも印が要る）。
 *   fixed は既にある行の所属先を変えない（target = null）
 */
export function resolveOwner(
  ctx: StageContext,
  current: string | null,
  code: string,
  mark: "productEdit" | "substanceEdit",
): { target: string | null } | string {
  if (current && !canOn(ctx.actor, mark, current)) return "編集できません";
  let target: string | null;
  if (ctx.mode === "fixed") {
    target = current ? null : ctx.fixedOwner;
    if (!current && !target) return "管理グループが選ばれていません";
  } else {
    if (!code) return "管理グループが空です";
    const found = ctx.owners.find((o) => o.code === code);
    if (!found) return `管理グループ「${code}」はありません`;
    target = found.id;
  }
  if (target && target !== current && !canOn(ctx.actor, mark, target)) {
    const label = ctx.owners.find((o) => o.id === target)?.code ?? "";
    return `管理グループ「${label}」は編集できません`;
  }
  return { target: target === current ? null : target };
}

/**
 * 公開の状態のせいで直せないときの文（直せるなら null）。読み取りと反映で同じ文を出す。
 * 決まりは画面と同じ（lib/product-service.ts の editableInState）: 承認待は誰も直せない、
 * 作成中・却下は作った本人だけ（システム管理グループは別）。製品・原材料の項目、組成、物質のどれにも使う。
 * what は「の組成」など（何が直せないのか）。印（管理グループの表）は別に確かめること
 */
export function stateRefusal(
  actor: Actor,
  target: { publishState: PublishState; createdBy: string | null } | undefined,
  what = "",
): string | null {
  if (target && editableInState(actor, target)) return null;
  return target?.publishState === "PENDING"
    ? `承認待のもの${what}は直せません（申請を取り下げてから直します）`
    : `公開前のもの${what}は、作った本人しか直せません`;
}

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
