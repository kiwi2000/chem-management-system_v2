/**
 * 含有率などの小数を、100万倍した整数（bigint）として扱う道具。
 * 合計や差を出すのに浮動小数点を経由させないため（Float は禁止）。
 *
 * 画面とサーバーで同じ結果を出したいので、DB の Decimal 型ではなくここに置いている。
 */

/** 小数点以下の桁数。DB 側の Decimal(9,6) と揃えること */
export const PCT_SCALE = 6;

const FACTOR = 10n ** BigInt(PCT_SCALE);

/**
 * "12.5" → 12500000n。
 * 数値として読めない場合と、小数桁が多すぎる場合は null を返す。
 */
export function toScaled(value: string): bigint | null {
  const s = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;

  const negative = s.startsWith("-");
  const body = negative ? s.slice(1) : s;
  const [intPart = "0", fracPart = ""] = body.split(".");
  if (fracPart.length > PCT_SCALE) return null;

  const scaled = BigInt(intPart) * FACTOR + BigInt(fracPart.padEnd(PCT_SCALE, "0"));
  return negative ? -scaled : scaled;
}

/** 12500000n → "12.5"（末尾の 0 は落とす） */
export function fromScaled(v: bigint): string {
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const frac = (abs % FACTOR).toString().padStart(PCT_SCALE, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${abs / FACTOR}${frac ? `.${frac}` : ""}`;
}

/** 読めない値は 0 として飛ばす（検証済みの値を渡すこと） */
export function sumScaled(values: (string | null | undefined)[]): bigint {
  let total = 0n;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    total += toScaled(v) ?? 0n;
  }
  return total;
}

/** 100（%）を表す値 */
export const SCALED_HUNDRED = 100n * FACTOR;
