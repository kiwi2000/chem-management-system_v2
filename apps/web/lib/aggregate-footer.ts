/**
 * 最終組成の表のいちばん下の行（2026-10-14 指示）。
 *
 * 組成を 1 行ずつ見るのではなく、**製品全体で見たときの結論**を列ごとに 1 つ出す。
 * 決め方は**表の行に出ている印だけ**から（判定結果の画面とは別。非該当に付いた要確認は数えない）。
 * 非該当の要確認は組成を意識する人にだけ見せる内容なので、ここには入れない（ユーザーの判断）。
 *
 * 列をまとめているとき（地域でまとめた列・インベントリをまとめた列）は出さない。
 * 中身の違う列を 1 つにまとめた結論は意味を持たないため。
 */

/** 法規制の列の結論 */
export type RegulationFoot = "applicable" | "review" | "notApplicable" | "notJudged";

/** インベントリの列の結論 */
export type InventoryFoot = "allListed" | "review";

/**
 * 法規制の列。表の行で、その列の区分に当たっている印を数える。
 *
 * - 要確認の印（?）が付いていない当たりが 1 つでもある → 該当。「?」付きの当たりが一緒にあっても該当
 *   （「?」付きを調べた結果がどうであれ、製品として該当なのは変わらない。「該当・要確認」とは出さない。2026-10-14 決定）
 * - 「?」付きの当たりだけ → 要確認
 * - どちらも無い → 非該当。ただし判定したことが無い製品は「未判定」（空を非該当と読ませない）
 *
 * 含有率不足の印（オレンジ）は当たりではないので数えない。施行前・適用終了も表の行に出ないので非該当になる
 */
export function regulationFoot(
  rows: { regulations: { categoryId: string; needsReview: boolean }[] }[],
  categoryIds: ReadonlySet<string>,
  judged: boolean,
): RegulationFoot {
  let applicable = false;
  let review = false;
  for (const row of rows) {
    for (const r of row.regulations) {
      if (!categoryIds.has(r.categoryId)) continue;
      if (r.needsReview) review = true;
      else applicable = true;
    }
  }
  if (applicable) return "applicable";
  if (review) return "review";
  return judged ? "notApplicable" : "notJudged";
}

/**
 * インベントリの列。**組成の全部の行**がそのインベントリに載っていれば「全て該当」。
 * 1 行でも載っていない（CAS 番号の無い行を含む）か、中身の分からない分があれば「要確認」
 */
export function inventoryFoot(
  rows: { numbers: { inventoryId: string }[] }[],
  inventoryId: string,
  incomplete: boolean,
): InventoryFoot {
  if (incomplete || rows.length === 0) return "review";
  return rows.every((row) => row.numbers.some((n) => n.inventoryId === inventoryId))
    ? "allListed"
    : "review";
}
