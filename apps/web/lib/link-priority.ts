/**
 * どのデータソースの結び付きを採用するかを決める。
 *
 * **単位は「規制区分 × CAS」。**その区分でそのCASを結んでいるデータソースのうち、
 * 優先度がいちばん高いもの1つだけが勝ち、**勝ったデータソースの結び付きだけを使う**。
 *
 * 法文物質名ごとに決めると、LOLI が号Aを、CHRIP が号Bを持っているときに
 * どちらも採用され、1つの区分の中でデータソースが混ざる。
 * 「このCASについては、いちばん信頼するデータソースの言うことだけを聞く」
 * という決めかたにそろえる。
 *
 * **勝ったデータソースが持っていない号は、下位が持っていても見ない。**
 * そのぶん該当が減ることがあるが、混ざるよりも筋が通る。
 *
 * 判定・まとめ表・セルを開く窓・含有率不足の4か所で同じ答えにするため、
 * ここに1つだけ置く。
 */

export interface PriorityLink {
  /** どの規制区分の話か */
  categoryId: string;
  casNormalized: string;
  sourceId: string;
}

/**
 * 「規制区分 × CAS」ごとの、勝ったデータソースの優先度。
 * `order` は データソースID → 優先度（小さいほど優先）。
 */
export function winningRank(
  links: PriorityLink[],
  order: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of links) {
    // 並びに無いデータソースは、いちばん後ろ扱い
    const at = order.get(l.sourceId) ?? Number.MAX_SAFE_INTEGER;
    const key = `${l.categoryId}/${l.casNormalized}`;
    const now = out.get(key);
    if (now === undefined || at < now) out.set(key, at);
  }
  return out;
}

/** その結び付きが採用されるか */
export function isAdopted(
  link: PriorityLink,
  order: Map<string, number>,
  winner: Map<string, number>,
): boolean {
  const at = order.get(link.sourceId) ?? Number.MAX_SAFE_INTEGER;
  return winner.get(`${link.categoryId}/${link.casNormalized}`) === at;
}
