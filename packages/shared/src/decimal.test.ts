import { describe, expect, it } from "vitest";
import {
  RATIO_ONE,
  fromScaled,
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
