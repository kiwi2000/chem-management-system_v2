/**
 * 無効にしたデータソースを「無いもの」として扱うための条件（2026-09-18 指示）。
 *
 * データソース（バージョン × 種別）には「有効」がある。外すと、そのバージョンでは
 * その種別のリンク（規制対象CAS）と数値の行（インベントリ）を、判定・採用の勝ち負け・画面・帳票・
 * スコアのどれにも出さない。行そのものは消さないので、有効に戻せば元どおりになる。
 *
 * **条件は「そのバージョンで無効にされていない」**にしてある（「有効なものに限る」ではない）。
 * バージョンに並んでいない種別（orphan）のリンクは、いままでどおり取り消し線付きで出し、
 * 勝ち負けにも参加させる。無効はそれとは別の状態
 */

/** Prisma の where に広げて使う。リンク（statutoryCasLink）と数値の行（inventoryRow）のどちらにも効く */
export function notDisabledIn(versionId: string) {
  return { source: { versions: { none: { versionId, enabled: false } } } };
}

/** 生の SQL 用。`alias` はリンクまたは数値の行の別名（version_id / source_id を持つこと） */
export function notDisabledSql(alias: string): string {
  return (
    `NOT EXISTS (SELECT 1 FROM link_version_sources x` +
    ` WHERE x.version_id = ${alias}.version_id AND x.source_id = ${alias}.source_id AND x.enabled = false)`
  );
}
