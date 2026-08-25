import { describe, expect, it } from "vitest";
import { elementFraction, parseFormula } from "./formula";

/**
 * 分子式から「その元素として何％か」を出すところ。
 *
 * ここが狂うと、閾値の境目で判定が変わる。しかも数字が少しずれるだけなので、
 * 画面を見ても気づけない。**実際の値が分かっているもので確かめる。**
 */
const W = new Map<string, number>([
  ["H", 1.008],
  ["C", 12.011],
  ["N", 14.007],
  ["O", 15.999],
  ["Na", 22.99],
  ["S", 32.06],
  ["Cl", 35.45],
  ["Ca", 40.078],
  ["Cr", 51.996],
  ["Zn", 65.38],
  ["Cd", 112.414],
  ["Pb", 207.2],
]);

/** 見やすいように％で、小数2桁に丸める */
const pct = (formula: string, el: string) => {
  const f = elementFraction(formula, el, W);
  return f === null ? null : Math.round(f * 10000) / 100;
};

describe("分子式を読む", () => {
  it("元素記号と数字の並びを読む", () => {
    expect(parseFormula("OZn")).toEqual(
      new Map([
        ["O", 1],
        ["Zn", 1],
      ]),
    );
  });

  it("2桁以上の数字を読む", () => {
    // LOLI は O4Pb3 のように、並び順も数字も素直でない書きかたをする
    expect(parseFormula("O4Pb3")).toEqual(
      new Map([
        ["O", 4],
        ["Pb", 3],
      ]),
    );
  });

  it("塩や水和物の「.」で区切られた並びを、全部足す", () => {
    expect(parseFormula("CrH2O4.Pb")).toEqual(
      new Map([
        ["Cr", 1],
        ["H", 2],
        ["O", 4],
        ["Pb", 1],
      ]),
    );
  });

  it("括弧でくくった部分を倍にする", () => {
    expect(parseFormula("Ca(NO3)2")).toEqual(
      new Map([
        ["Ca", 1],
        ["N", 2],
        ["O", 6],
      ]),
    );
  });

  it("先頭の数字は、その後ろ全体にかかる（水和物）", () => {
    // CuSO4.5H2O の「5H2O」は、水が5つ
    expect(parseFormula("5H2O")).toEqual(
      new Map([
        ["H", 10],
        ["O", 5],
      ]),
    );
  });

  it("分数の書きかたを読む", () => {
    // AsO2.1/2Zn は Zn(AsO2)2 のこと。Zn は半分
    expect(parseFormula("AsO2.1/2Zn")).toEqual(
      new Map([
        ["As", 1],
        ["O", 2],
        ["Zn", 0.5],
      ]),
    );
  });

  it("2文字・3文字の元素記号を取り違えない", () => {
    // 「Cl」を「C」＋「l」と読んではいけない
    expect(parseFormula("NaCl")).toEqual(
      new Map([
        ["Na", 1],
        ["Cl", 1],
      ]),
    );
  });

  it("読めない書きかたは null（適当な数を返さない）", () => {
    for (const bad of ["", "   ", "cl2", "3", "Pb2+", "H2O·2H2O", "(OH", "??"]) {
      expect(parseFormula(bad)).toBeNull();
    }
  });
});

describe("元素として何％か", () => {
  it("よく知られた値と一致する", () => {
    expect(pct("OPb", "Pb")).toBe(92.83); // 一酸化鉛
    expect(pct("O4Pb3", "Pb")).toBe(90.67); // 四酸化三鉛（鉛丹）
    expect(pct("OZn", "Zn")).toBe(80.34); // 酸化亜鉛
    expect(pct("CrO3", "Cr")).toBe(52.0); // 三酸化クロム
    expect(pct("CdCl2", "Cd")).toBe(61.32); // 塩化カドミウム
  });

  it("金属そのものは 100％", () => {
    expect(pct("Pb", "Pb")).toBe(100);
  });

  it("塩の形でも、その元素ぶんだけを数える", () => {
    /*
      LOLI は塩を「酸.金属」の形で書く（CrH2O4.Pb ＝ クロム酸 ＋ 鉛）。
      **実際の塩 PbCrO4 には水素が無い。**書かれたとおりに数えると、
      水素のぶんだけ分母が大きくなり、金属の割合が少し小さく出る。

        書かれたとおり  63.71％
        実際の PbCrO4   64.11％

      **小さく出るのは見落とす向きの誤り**だが、差は 0.4 ポイントで、
      これを直すには塩の価数を知る必要があり、当て推量になる。
      いまは書かれたとおりに数え、そのことを記録に残す。
    */
    expect(pct("CrH2O4.Pb", "Pb")).toBe(63.71);
    expect(pct("CrH2O4.Pb", "Cr")).toBe(15.99);
  });

  it("その元素が入っていなければ null", () => {
    expect(pct("OZn", "Pb")).toBeNull();
  });

  it("原子量の分からない元素が混ざっていたら null", () => {
    /*
      **0 として計算してはいけない。**
      分母が小さくなって、割合が実際より大きく出る
    */
    expect(pct("XyPb", "Pb")).toBeNull();
  });
});
