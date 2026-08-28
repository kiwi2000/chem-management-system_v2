/**
 * 法律の並び順。
 *
 * **地域 → 国 → 法律 → 区分**の順に出す。この4つを全部見ないと並びが決まらない。
 *
 * 以前は `law.displayOrder` だけで並べていたが、**並び順は国ごとに1から振ってある**ため、
 * 国をまたぐと混ざった。実際に、韓国のPOPs法（50）が化管法（50）と同じ値になり、
 * 日本の法律の途中に割り込んでいた。
 *
 * ```
 *   化審法 10 → 安衛法 30 → 化管法 50 → 韓国POPs法 50 → 水濁法 70 → 中国 104 …
 * ```
 *
 * **並べる場所ごとに書かない。**画面によって順が違うと、同じ製品を
 * 別の画面で見たときに並びが変わって、見比べられなくなる。
 */

/**
 * 利用者が並べ替えを選んでいない（＝「表示順」のまま）か。
 *
 * **表示順の列で並べる＝この規則で並べる**、という意味にする。
 * `displayOrder` は地域・国ごとに1から振ってあるので、その列だけで並べると
 * 親が混ざる。列の見出しを押したときも、意味は「決めた順に並べる」で変わらない。
 */
export function isNaturalOrder(sort: { column: string; direction: string }[]): boolean {
  if (sort.length === 0) return true;
  return sort.length === 1 && sort[0]?.column === "displayOrder" && sort[0]?.direction === "asc";
}

/** 地域そのものを並べるとき用 */
export const REGION_ORDER_BY = [{ displayOrder: "asc" }, { code: "asc" }] as const;

/**
 * 国を並べるとき用。**地域が先。**
 * 地域の順を入れ替えると、その地域の国がまとまって動く
 */
export const COUNTRY_ORDER_BY = [
  { region: { displayOrder: "asc" } },
  { displayOrder: "asc" },
  { code: "asc" },
] as const;

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
