import { describe, expect, it } from "vitest";
import {
  RATIO_ONE,
  compareFine,
  fineToPct,
  fromScaled,
  ratioToFine,
  ratioOfPct,
  ratioToPct,
  timesPct,
  toScaled,
  type Ratio,
} from "./decimal";

/**
 * 含有率の計算は Float を通さない約束になっている。
 * 特に組成の展開は掛け算を段の数だけ重ねるので、丸めをどこで行うかで結果が変わる。
 * 「掛けている間は丸めない」が崩れていないかを、ここで固定しておく。
 */

/** 段を順に掛けていく（展開のときと同じ手順） */
const through = (...pcts: string[]): Ratio =>
  pcts.reduce<Ratio>((r, p) => timesPct(r, p) ?? r, RATIO_ONE);

describe("timesPct / ratioToPct", () => {
  it("原材料30%の中の物質50%は、製品全体では15%", () => {
    expect(ratioToPct(through("30", "50"))).toBe("15");
  });

  it("10%を3段たどると0.1%", () => {
    expect(ratioToPct(through("10", "10", "10"))).toBe("0.1");
  });

  it("100%だけの段は値を変えない", () => {
    expect(ratioToPct(through("100", "100"))).toBe("100");
    expect(ratioToPct(through("42.5", "100"))).toBe("42.5");
  });

  it("6桁より下は四捨五入する", () => {
    // 0.0001% の中の 0.5% = 0.0000005%。6桁に収まらないので繰り上げる
    expect(ratioToPct(through("0.0001", "0.5"))).toBe("0.000001");
  });

  it("読めない値は null（呼び出し側で展開できないものとして扱う）", () => {
    expect(timesPct(RATIO_ONE, "abc")).toBeNull();
    expect(timesPct(RATIO_ONE, "1.2345678")).toBeNull(); // 小数7桁は受けない
  });

  it("ratioOfPct は1段目の比率を作る", () => {
    expect(ratioToPct(ratioOfPct("30")!)).toBe("30");
  });
});

describe("段ごとに丸めてはいけない", () => {
  /** わざと段ごとに丸める（やってはいけないほうのやり方） */
  const roundEachStep = (first: string, ...rest: string[]): string =>
    rest.reduce(
      (acc, p) => ratioToPct(timesPct({ num: toScaled(acc)!, den: 100n * 10n ** 6n }, p)!),
      first,
    );

  it("段ごとに丸めると答えがずれる", () => {
    const pcts = ["0.333333", "1.5", "0.15"] as const;
    expect(ratioToPct(through(...pcts))).toBe("0.000007");
    expect(roundEachStep(...pcts)).toBe("0.000008");
  });
});

describe("fromScaled", () => {
  it("末尾の0は落とす", () => {
    expect(fromScaled(15n * 10n ** 6n)).toBe("15");
    expect(fromScaled(1500000n)).toBe("1.5");
  });
});

describe("合算（ratioToFine / fineToPct）", () => {
  const fine = (...pcts: string[]) => ratioToFine(through(...pcts));

  it("1件だけなら ratioToPct と同じ値になる", () => {
    expect(fineToPct(fine("30", "50"))).toBe("15");
    expect(fineToPct(fine("10", "10", "10"))).toBe("0.1");
  });

  it("別の場所から来た同じ物質を足せる", () => {
    // エポキシ樹脂：積層板の中（40%→67%→38%）と、製品に直接 5%
    const total = fine("40", "67", "38") + fine("5");
    expect(fineToPct(total)).toBe("15.184");
  });

  it("同じCASの別IDを足せる", () => {
    // 銅：はんだの中（40%→8%→0.5%）と、銅箔の中（40%→25%→99.95%）
    const total = fine("40", "8", "0.5") + fine("40", "25", "99.95");
    expect(fineToPct(total)).toBe("10.011");
  });

  it("5段たどった値も足せる", () => {
    // 水酸化アルミニウム：積層板経由と筐体経由
    const total = fine("40", "67", "2", "60") + fine("55", "12", "60");
    expect(fineToPct(total)).toBe("4.2816");
  });

  it("末端をすべて足すと 100% になる", () => {
    const all = [
      fine("40", "8", "96.5"), // すず
      fine("40", "8", "3"), // 銀
      fine("40", "8", "0.5"), // 銅A
      fine("40", "25", "99.95"), // 銅B
      fine("40", "25", "0.05"), // 鉛
      fine("40", "67", "38"), // エポキシ（積層板）
      fine("5"), // エポキシ（接着剤）
      fine("40", "67", "5"), // 難燃剤
      fine("40", "67", "2", "60"), // 水酸化アルミ（積層板経由）
      fine("40", "67", "2", "39.5"), // ポリエチレン（積層板経由）
      fine("40", "67", "2", "0.5"), // カーボンブラック（積層板経由）
      fine("40", "67", "55"), // ガラス繊維
      fine("55", "12", "60"), // 水酸化アルミ（筐体経由）
      fine("55", "12", "39.5"), // ポリエチレン（筐体経由）
      fine("55", "12", "0.5"), // カーボンブラック（筐体経由）
      fine("55", "87.5"), // ABS
      fine("55", "0.5"), // 二酸化チタン
    ].reduce((a, b) => a + b, 0n);
    expect(fineToPct(all)).toBe("100");
  });

  it("多い順に並べられる", () => {
    const sorted = [fine("0.5"), fine("48.125"), fine("15.184")].sort((a, b) => compareFine(b, a));
    expect(sorted.map(fineToPct)).toEqual(["48.125", "15.184", "0.5"]);
  });
});
