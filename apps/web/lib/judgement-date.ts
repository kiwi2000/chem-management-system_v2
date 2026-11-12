/**
 * 判定対象日と、適用期間の扱い。**ここはデータベースを知らない。**
 *
 * 判定は必ず「判定対象日」を持つ（2026-09-22 決定）。
 * 保存する判定はその日に効いている規制で見たもので、日付は判定の行と実行の記録に残る。
 * 施行前・適用終了の法文物質名は該当に数えず、印を付けて残す（該非そのものは含有率で決めたまま持つ）。
 */

/** 法文物質名（または区分）が判定対象日に効いているか */
export type Effective = "IN_FORCE" | "NOT_YET" | "EXPIRED";

/**
 * 今日の日付（YYYY-MM-DD）。**日本の日付で決める。**
 * サーバーの時計が UTC でも、施行日の朝に「施行前」と出さないため
 */
export function todayInJapan(now: Date = new Date()): string {
  return dayInJapan(now);
}

/**
 * 時刻を持つ値（作成日時など）を、日本の日付（YYYY-MM-DD）にする。
 * `toISOString().slice(0, 10)` は世界標準時の日付で、日本の 0〜9 時のものが前の日になる
 */
export function dayInJapan(at: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(at);
}

/** 日本は世界標準時より 9 時間早い（夏時間は無い） */
const JAPAN_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 日本の時刻を、世界標準時の読み方（getUTC…・toISOString）でそのまま読める値にずらす。
 * **ずらした値は「いつ」を表さない。**時・日付の数字を取り出すためだけに使う（何万件も数える集計で、1 件ずつ整形の道具を作らないため）
 */
function shiftedToJapan(at: Date): Date {
  return new Date(at.getTime() + JAPAN_OFFSET_MS);
}

/**
 * 日本の時刻の「時」（0〜23）。`getHours()` はサーバーの時計の地域で決まるので、
 * 世界標準時で動くサーバー（Docker・Railway）では 9 時間ずれる
 */
export function hourInJapan(at: Date): number {
  return shiftedToJapan(at).getUTCHours();
}

/** 日本の日時を、ファイル名に使える形（YYYYMMDDTHHMMSS）にする */
export function stampInJapan(at: Date): string {
  return shiftedToJapan(at).toISOString().replace(/[-:]/g, "").slice(0, 15);
}

/** YYYY-MM-DD の形で、実在する日付か */
export function isDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/**
 * 日付だけの列（時刻なし、UTC の 0 時で入っている）を YYYY-MM-DD にする。
 * ISO 文字列の日付部分がそのまま登録した日付になる
 */
export function dayOf(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * 適用開始日・適用終了日から、その日に効いているかを決める。
 * 空の日付は「いつでも」。開始日はその日を含み、終了日もその日を含む
 */
export function effectiveOn(
  effectiveFrom: Date | string | null | undefined,
  effectiveTo: Date | string | null | undefined,
  asOf: string,
): Effective {
  const from = typeof effectiveFrom === "string" ? effectiveFrom : dayOf(effectiveFrom);
  const to = typeof effectiveTo === "string" ? effectiveTo : dayOf(effectiveTo);
  if (from !== null && from > asOf) return "NOT_YET";
  if (to !== null && to < asOf) return "EXPIRED";
  return "IN_FORCE";
}

/**
 * 区分と法文物質名の適用期間を合わせる。**区分が効いていなければ、中の法文物質名も効かない**
 * （区分が無効になる日は、配下の法文物質名もすべて無効になる日とみなす。2026-09-22 決定）
 */
export function combineEffective(category: Effective, substance: Effective): Effective {
  return category !== "IN_FORCE" ? category : substance;
}
