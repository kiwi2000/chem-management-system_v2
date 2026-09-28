import type { Locale } from "@chem/shared";

/**
 * SDS を作る対象の「国」（管轄）。利用者は「国」と呼ぶが、意味は規制体系（S23 §2）。
 * 国と 1 対 1 ではない（EU は 1 つ、米国は省庁で分かれる）。まずはこの並び。要るときに足す
 */
export const SDS_COUNTRIES: { code: string; name: Record<Locale, string> }[] = [
  { code: "JP", name: { ja: "日本", en: "Japan" } },
  { code: "EU", name: { ja: "EU", en: "EU" } },
  { code: "GB", name: { ja: "英国", en: "United Kingdom" } },
  { code: "KR", name: { ja: "韓国", en: "Korea" } },
  { code: "CN", name: { ja: "中国", en: "China" } },
  { code: "TW", name: { ja: "台湾", en: "Taiwan" } },
  { code: "US", name: { ja: "米国", en: "United States" } },
  { code: "AU", name: { ja: "オーストラリア", en: "Australia" } },
  { code: "OTHER", name: { ja: "その他", en: "Other" } },
];

export const DEFAULT_COUNTRY = "JP";

export function countryName(code: string, locale: Locale): string {
  return SDS_COUNTRIES.find((c) => c.code === code)?.name[locale] ?? code;
}
