import { describe, expect, it } from "vitest";
import { isAdopted, winningRank, type PriorityLink } from "./link-priority";

/**
 * どのデータソースを採用するか。
 *
 * ここが狂うと、**該当するものを「該当しない」と答える**。
 * 逆に、信頼していないデータの言い分で該当を出してしまうこともある。
 */

/** USER が最優先、次に LOLI、最後に CHRIP */
const order = new Map([
  ["user", 0],
  ["loli", 1],
  ["chrip", 2],
]);

const link = (categoryId: string, casNormalized: string, sourceId: string): PriorityLink => ({
  categoryId,
  casNormalized,
  sourceId,
});

describe("勝つデータソースを決める", () => {
  it("同じ区分・同じCASなら、優先度がいちばん高いものが勝つ", () => {
    const chrip = link("c1", "108-88-3", "chrip");
    const loli = link("c1", "108-88-3", "loli");
    const w = winningRank([chrip, loli], order);
    expect(isAdopted(loli, order, w)).toBe(true);
    expect(isAdopted(chrip, order, w)).toBe(false);
  });

  /*
    **これが今回の肝。**号が違っても、区分とCASが同じなら取り合いになる。
    号ごとに決めると、1つのセルに LOLI と CHRIP が並んでしまう
  */
  it("別の法文物質名でも、区分とCASが同じなら下位は採用しない", () => {
    const loli = link("c1", "108-88-3", "loli");
    const chrip = link("c1", "108-88-3", "chrip");
    // 号が違っても（この関数は号を見ない）、勝つのは LOLI だけ
    const w = winningRank([loli, chrip], order);
    expect(isAdopted(loli, order, w)).toBe(true);
    expect(isAdopted(chrip, order, w)).toBe(false);
  });

  it("区分が違えば別々に決まる", () => {
    const a = link("c1", "108-88-3", "loli");
    const b = link("c2", "108-88-3", "chrip");
    const w = winningRank([a, b], order);
    // c2 には LOLI がいないので、CHRIP が勝つ
    expect(isAdopted(a, order, w)).toBe(true);
    expect(isAdopted(b, order, w)).toBe(true);
  });

  it("CASが違えば別々に決まる", () => {
    const a = link("c1", "108-88-3", "loli");
    const b = link("c1", "71-43-2", "chrip");
    const w = winningRank([a, b], order);
    expect(isAdopted(a, order, w)).toBe(true);
    expect(isAdopted(b, order, w)).toBe(true);
  });

  it("同じデータソースが同じ区分・CASで複数の号を持っていれば、全部採用する", () => {
    const a = link("c1", "108-88-3", "loli");
    const b = link("c1", "108-88-3", "loli");
    const w = winningRank([a, b], order);
    expect(isAdopted(a, order, w)).toBe(true);
    expect(isAdopted(b, order, w)).toBe(true);
  });

  /*
    **並びに無いデータソースを勝たせない。**そのバージョンに登録されていない
    データソースの行が残っていることがあり、勝たせると
    画面のどこにも意味を出せない印が付く
  */
  it("そのバージョンの並びに無いデータソースは、いちばん後ろに回る", () => {
    const known = link("c1", "108-88-3", "chrip");
    const unknown = link("c1", "108-88-3", "ecantacted");
    const w = winningRank([unknown, known], order);
    expect(isAdopted(known, order, w)).toBe(true);
    expect(isAdopted(unknown, order, w)).toBe(false);
  });

  it("並びに無いものしかなければ、それが勝つ", () => {
    const only = link("c1", "108-88-3", "cfr");
    const w = winningRank([only], order);
    expect(isAdopted(only, order, w)).toBe(true);
  });

  it("結び付きが無ければ、何も勝たない", () => {
    expect(winningRank([], order).size).toBe(0);
  });
});
