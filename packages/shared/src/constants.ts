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

/**
 * CAS番号の最後の1桁（チェックデジット）が合っているか。
 *
 * 決めかたは CAS の定義どおり。**最後の桁を除いた数字を右から 1, 2, 3 … 倍して足し、
 * 10 で割った余り**が最後の桁になる（7439-92-1 なら
 * 2×1 + 9×2 + 9×3 + 3×4 + 4×5 + 7×6 = 121、121 % 10 = 1）。
 *
 * 形が合っていないものは判定できないので false を返さず、呼ぶ側で形を先に見る
 */
export function casCheckDigitOk(normalized: string): boolean {
  if (!looksLikeCas(normalized)) return false;
  const digits = normalized.replace(/-/g, "");
  const check = Number(digits[digits.length - 1]);
  let sum = 0;
  for (let i = 0; i < digits.length - 1; i += 1) {
    // 右から数えた位置（1 始まり）を掛ける
    sum += Number(digits[digits.length - 2 - i]) * (i + 1);
  }
  return sum % 10 === check;
}

/**
 * CAS番号の何がおかしいか。問題が無ければ null。
 *
 *   `"format"`     … 数字とハイフンの並びが CAS の形になっていない
 *   `"checkDigit"` … 形は合っているが、最後の1桁が合わない（打ち間違いの多くはこれ）
 *
 * **2つを分けて返す。**「形が違う」と「1桁だけ違う」では直しかたが別なので、
 * 同じ文言にすると打ち間違いを探し直すことになる（2026-09-20 指示）
 */
export function casProblem(normalized: string): "format" | "checkDigit" | null {
  if (!looksLikeCas(normalized)) return "format";
  return casCheckDigitOk(normalized) ? null : "checkDigit";
}

/**
 * 閾値が**何に対する濃度か**。
 *
 * ほとんどの法律は製品全体に対する重量%だが、RoHS のように
 * **均質材料あたり**で決まるものがある（ねじのめっき、基板のはんだ など）。
 * 製品全体で割ると必ず薄まるので、そのままでは違反を見落とす。
 */
export const THRESHOLD_BASES = ["PRODUCT", "HOMOGENEOUS_MATERIAL"] as const;
export type ThresholdBasis = (typeof THRESHOLD_BASES)[number];
