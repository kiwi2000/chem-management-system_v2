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

/**
 * 累積した比率。分子と分母を整数で持つ。
 *
 * 組成の展開では「親の%×子の%÷100」を段の数だけ掛けていく。
 * 段ごとに丸めると、その誤差が下の段に持ち越されて積み上がるので、
 * 掛けている間は割らずに持ち、表示するときに一度だけ丸める。
 */
export interface Ratio {
  num: bigint;
  den: bigint;
}

/** 100%（掛け算の出発点） */
export const RATIO_ONE: Ratio = { num: 1n, den: 1n };

/**
 * 比率に「その中での含有率（%）」を掛ける。100 で割るところまで含む。
 * 読めない値のときは null（呼び出し側で「展開できない」として扱う）。
 */
export function timesPct(ratio: Ratio, pct: string): Ratio | null {
  const scaled = toScaled(pct);
  if (scaled === null) return null;
  return { num: ratio.num * scaled, den: ratio.den * SCALED_HUNDRED };
}

/** 含有率の文字列から比率を作る（展開の1段目に使う） */
export function ratioOfPct(pct: string): Ratio | null {
  return timesPct(RATIO_ONE, pct);
}

/**
 * 比率を % の文字列にする。小数6桁で四捨五入（DB の Decimal(9,6) と同じ桁）。
 * 丸めるのはここだけ。
 */
export function ratioToPct(ratio: Ratio): string {
  if (ratio.den === 0n) return "0";
  // 6桁ぶん上げてから割る。あと1桁を見て四捨五入するため、さらに10倍して割る
  const tenTimes = (ratio.num * SCALED_HUNDRED * 10n) / ratio.den;
  const negative = tenTimes < 0n;
  const abs = negative ? -tenTimes : tenTimes;
  const rounded = (abs + 5n) / 10n;
  return fromScaled(negative ? -rounded : rounded);
}
