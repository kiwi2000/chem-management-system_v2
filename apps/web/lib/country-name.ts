"use client";

/**
 * 国コードを、読める名前にする。
 *
 * 国名の表は持たない。ブラウザとNode.jsに元から入っているものを使う
 * （Intl.DisplayNames）。自前で持つと、国名が変わったときに直し忘れる。
 */
const cache = new Map<string, Intl.DisplayNames>();

function namesFor(locale: string): Intl.DisplayNames {
  let dn = cache.get(locale);
  if (!dn) {
    dn = new Intl.DisplayNames([locale], { type: "region" });
    cache.set(locale, dn);
  }
  return dn;
}

/**
 * 表に出す場所の名前。
 *
 *   "local" … 自分自身（開発中など）
 *   null    … 分からない（社内の回線など、割り当て表に無いもの）
 */
export function countryName(code: string | null, locale: string, m: { local: string }): string {
  if (!code) return "";
  if (code === "local") return m.local;
  try {
    return namesFor(locale).of(code) ?? code;
  } catch {
    return code;
  }
}
