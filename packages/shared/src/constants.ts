/**
 * 定数・正規化ユーティリティ（循環importを避けるため index から分離）。
 *
 * システム設定のキーと既定値は settings.ts の SETTING_DEFS に一本化してある。
 * 検証モードの定義は composition.ts にある。
 */

/** 全角英数記号を半角へ（コード・CAS番号の表記ゆれ対策） */
function toHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * コードの正規化（全角→半角・trim・大文字化）。
 * DB照合順序差（PG=区別 / MySQL・SQL Server=非区別）を吸収するため、
 * 突合・一意判定は必ず正規化値で行う。
 */
export function normalizeCode(raw: string): string {
  return toHalfWidth(raw).trim().toUpperCase();
}

/**
 * CAS番号の正規化。
 * 法規制リンクと金属換算係数は**物質IDではなくCASで突合する**ため、
 * ここが緩いと突合漏れがそのまま規制の見落としになる。表記ゆれを徹底して潰す:
 *   全角→半角 / 各種ハイフン・長音を "-" に統一 / 空白（全角含む）を除去 / 大文字化
 */
export function normalizeCas(raw: string): string {
  return toHalfWidth(raw)
    .replace(/[‐-―−ー－˗֊᠆]/g, "-")
    .replace(/\s/g, "") // JS の \s は全角スペース(U+3000)も含む
    .toUpperCase();
}

/** CAS番号の一般的な形（例: 7439-92-1）。合わない場合も保存は通し、警告だけ出す */
export function looksLikeCas(normalized: string): boolean {
  return /^\d{2,7}-\d{2}-\d$/.test(normalized);
}
