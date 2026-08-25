/**
 * LOLI の**金属換算係数のリスト**（ListID 9533）を読む。
 *
 *   Japan - Pollutant Release Transfer Register (PRTR)
 *   - Class 1 Substances - Metal Conversion Factors (2021 Amendment)
 *
 * 化管法（PRTR）が定める「〜として」の換算率そのもの。
 * 分子式から計算した値より、**こちらが正**。法令が使う値だから。
 *
 * `Data` 欄の形:
 *
 *   Class 1 Control No. 31 >=1 % [0.507] (as Sb, Ordinance No. 48, [Antimony and its compounds]);
 *   Class 1 Control No. 242 >=1 % [0.493] (as Se, Ordinance No. 277, [Selenium and its compounds])
 *
 * 読むときの注意が3つある。
 *
 * 1. **1行に複数の金属が入る。**上の例は Sb と Se の両方。`;` で並ぶ
 * 2. **角括弧は係数以外にも使われる。**物質名（`[Antimony and its compounds]`）と、
 *    末尾の参照先CAS（`[1315-05-5]`）。数字だけの角括弧でも CAS はハイフンが入るので
 *    区別できるが、確実を期して**直後に `(as 元素,` が続くものだけ**を係数とみなす
 * 3. **係数を持たない行がある。**金属でない物質（ホルムアルデヒドなど）。飛ばす
 */

export interface MetalFactorHit {
  /** 換算先の元素記号（`as Pb` の Pb） */
  element: string;
  /** 換算係数。割合（0〜1）。LOLI はこの形で持つ */
  ratio: number;
}

/**
 * `[係数] (as 元素,` の並びを全部拾う。
 * 直後に `(as ...` が続くことを条件にしているので、物質名や参照先CASの
 * 角括弧を取り違えることがない。
 */
const FACTOR = /\[(\d+(?:\.\d+)?)\]\s*\(as\s+([A-Za-z]{1,3})\s*[,)]/g;

export function parseMetalFactors(data: string): MetalFactorHit[] {
  const hits: MetalFactorHit[] = [];
  for (const m of data.matchAll(FACTOR)) {
    const ratio = Number(m[1]);
    // 係数は割合。1 を超えるものは読み違えているので採らない
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) continue;
    hits.push({ element: m[2] as string, ratio });
  }
  return hits;
}
