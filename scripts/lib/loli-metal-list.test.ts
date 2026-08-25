import { describe, expect, it } from "vitest";
import { parseMetalFactors } from "./loli-metal-list";

describe("parseMetalFactors", () => {
  it("係数と換算先を取り出す", () => {
    expect(
      parseMetalFactors(
        "Specific class 1 Control No. 697 >=0.1 % [0.907] (as Pb, Ordinance No. 353, [Lead and its compounds])",
      ),
    ).toEqual([{ element: "Pb", ratio: 0.907 }]);
  });

  it("1行に複数の金属が入っていても全部拾う", () => {
    expect(
      parseMetalFactors(
        "Class 1 Control No. 31 >=1 % [0.507] (as Sb, Ordinance No. 48, [Antimony and its compounds]); " +
          "Class 1 Control No. 242 >=1 % [0.493] (as Se, Ordinance No. 277, [Selenium and its compounds])",
      ),
    ).toEqual([
      { element: "Sb", ratio: 0.507 },
      { element: "Se", ratio: 0.493 },
    ]);
  });

  it("係数が 1（単体金属）も拾う", () => {
    expect(
      parseMetalFactors(
        "Class 1 Control No. 412 >=1 % [1] (as Mn, Ordinance No. 465, [Manganese and its compounds])",
      ),
    ).toEqual([{ element: "Mn", ratio: 1 }]);
  });

  it("係数を持たない行は何も返さない（金属でない物質）", () => {
    expect(
      parseMetalFactors(
        "Specific class 1 Control No. 411 >=0.1 % (Ordinance No. 411, [Formaldehyde])",
      ),
    ).toEqual([]);
  });

  it("物質名の角括弧を係数と取り違えない", () => {
    // 末尾の [1332-77-0] は参照先のCAS。直後に (as が続かないので拾わない
    expect(
      parseMetalFactors(
        'Class 1 Control No. 405 >=1 % [0.185] (as B, Ordinance No. 458, [Boron compounds])" ' +
          "As Boron potassium oxide (B4K2O7) [1332-77-0]",
      ),
    ).toEqual([{ element: "B", ratio: 0.185 }]);
  });

  it("1 を超える値は採らない（読み違えているとみなす）", () => {
    expect(parseMetalFactors("[1.5] (as Pb, ...)")).toEqual([]);
    expect(parseMetalFactors("[0] (as Pb, ...)")).toEqual([]);
  });
});
