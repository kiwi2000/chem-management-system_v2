/**
 * 法令の並び順。
 *
 * **地域 → 国 → 法令 → 区分**の順に出す。この4つを全部見ないと並びが決まらない。
 *
 * 以前は `law.displayOrder` だけで並べていたが、**並び順は国ごとに1から振ってある**ため、
 * 国をまたぐと混ざった。実際に、韓国のPOPs法（50）が化管法（50）と同じ値になり、
 * 日本の法令の途中に割り込んでいた。
 *
 * ```
 *   化審法 10 → 安衛法 30 → 化管法 50 → 韓国POPs法 50 → 水濁法 70 → 中国 104 …
 * ```
 *
 * **並べる場所ごとに書かない。**画面によって順が違うと、同じ製品を
 * 別の画面で見たときに並びが変わって、見比べられなくなる。
 */

/** Prisma の `orderBy` に渡す形。`law` を直接引くとき用 */
export const LAW_ORDER_BY = [
  { country: { region: { displayOrder: "asc" } } },
  { country: { displayOrder: "asc" } },
  { displayOrder: "asc" },
  // 同じ値のときも並びが変わらないように、最後はコードで決める
  { code: "asc" },
] as const;

/** 同じものを、規制区分から引くとき用（区分の並びまで含む） */
export const CATEGORY_ORDER_BY = [
  { law: { country: { region: { displayOrder: "asc" } } } },
  { law: { country: { displayOrder: "asc" } } },
  { law: { displayOrder: "asc" } },
  { law: { code: "asc" } },
  { displayOrder: "asc" },
  // 区分の表示順は 0 のまま並んでいるものが多い。最後はコードで決める
  { code: "asc" },
] as const;

/** Prisma の `select` に足すと、下の `lawOrderKey` が使えるようになる */
export const LAW_ORDER_SELECT = {
  code: true,
  displayOrder: true,
  country: {
    select: { displayOrder: true, region: { select: { displayOrder: true } } },
  },
} as const;

export interface LawOrderSource {
  code: string;
  displayOrder: number;
  country: { displayOrder: number; region: { displayOrder: number } };
}

/**
 * 取り出したあとに並べ替えるとき用の鍵。
 * 数と文字が混ざるので、`compareLawOrder` で比べること。
 */
export function lawOrderKey(law: LawOrderSource, categoryOrder = 0) {
  return [
    law.country.region.displayOrder,
    law.country.displayOrder,
    law.displayOrder,
    law.code,
    categoryOrder,
  ] as const;
}

/** `lawOrderKey` で作った鍵どうしを比べる */
export function compareLawOrder(
  a: ReturnType<typeof lawOrderKey>,
  b: ReturnType<typeof lawOrderKey>,
): number {
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    const d =
      typeof x === "string" || typeof y === "string" ? String(x).localeCompare(String(y)) : x - y;
    if (d !== 0) return d;
  }
  return 0;
}
