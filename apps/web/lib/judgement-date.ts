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
export function todayInJapan(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
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
