import { describe, expect, it } from "vitest";
import { type RankBand, bandMatches, checkBands, describeBand, rankOf } from "./score";

const band = (
  label: string,
  lowerValue: string | null,
  upperValue: string | null,
  displayOrder = 0,
  lowerBound: RankBand["lowerBound"] = "INCLUSIVE",
  upperBound: RankBand["upperBound"] = "EXCLUSIVE",
): RankBand => ({ label, lowerValue, lowerBound, upperValue, upperBound, displayOrder });

/** 指示の例。0〜30 が 0、30〜70 が 1、70〜100 が 2 */
const EXAMPLE = [band("0", "0", "30", 1), band("1", "30", "70", 2), band("2", "70", "100", 3)];

describe("ランクの読み替え", () => {
  it("境目はどちらか一方の段にだけ入る", () => {
    // 30 は「30以上70未満」の側。両方に入ると、どちらとも言えなくなる
    expect(rankOf("29.999", EXAMPLE)).toBe("0");
    expect(rankOf("30", EXAMPLE)).toBe("1");
    expect(rankOf("69.999", EXAMPLE)).toBe("1");
    expect(rankOf("70", EXAMPLE)).toBe("2");
  });

  it("どの段にも入らなければ空", () => {
    // 100 は「70以上100未満」に入らない。上が開いている段が無いため
    expect(rankOf("100", EXAMPLE)).toBeNull();
    expect(rankOf("-1", EXAMPLE)).toBeNull();
  });

  it("段が1つも無ければ空", () => {
    expect(rankOf("50", [])).toBeNull();
  });

  it("不等号は段ごとに決められる", () => {
    // 「0を超えて30以下」
    const b = band("A", "0", "30", 1, "EXCLUSIVE", "INCLUSIVE");
    expect(bandMatches("0", b)).toBe(false);
    expect(bandMatches("0.001", b)).toBe(true);
    expect(bandMatches("30", b)).toBe(true);
    expect(bandMatches("30.001", b)).toBe(false);
  });

  it("上限が空なら、そこから上はすべて入る", () => {
    const bands = [band("0", "0", "30", 1), band("上限なし", "30", null, 2)];
    expect(rankOf("1000000", bands)).toBe("上限なし");
  });

  it("上下とも空の段は、受け皿になる", () => {
    const bands = [band("0", "0", "30", 1), band("その他", null, null, 2)];
    expect(rankOf("999", bands)).toBe("その他");
    expect(rankOf("-5", bands)).toBe("その他");
  });

  it("並び順に見て、最初に当てはまった段を採る", () => {
    // わざと重ねる。並び順が後の「B」ではなく「A」になる
    const bands = [band("A", "0", "100", 1), band("B", "50", "100", 2)];
    expect(rankOf("60", bands)).toBe("A");
  });

  it("段の名前は数字でなくてよい", () => {
    expect(rankOf("10", [band("要注意", "0", "30", 1)])).toBe("要注意");
  });

  it("小数のスコアも段に入る", () => {
    expect(rankOf("29.9999", EXAMPLE)).toBe("0");
  });
});

describe("対応表の見落とし", () => {
  it("指示どおりの3段なら、何も出ない", () => {
    expect(checkBands(EXAMPLE)).toEqual([]);
  });

  it("境目が両方「含む」なら重なりとして出す", () => {
    const bands = [
      band("0", "0", "30", 1, "INCLUSIVE", "INCLUSIVE"),
      band("1", "30", "70", 2, "INCLUSIVE", "EXCLUSIVE"),
    ];
    expect(checkBands(bands)).toEqual([{ kind: "overlap", at: [1, 2] }]);
  });

  it("段と段の間が空いていれば穴として出す", () => {
    const bands = [band("0", "0", "30", 1), band("1", "40", "70", 2)];
    expect(checkBands(bands)).toEqual([{ kind: "gap", at: [1, 2] }]);
  });

  it("受け皿の後ろに段があれば、使われないと出す", () => {
    const bands = [band("その他", null, null, 1), band("0", "0", "30", 2)];
    expect(checkBands(bands)).toContainEqual({ kind: "unreachable", at: [2] });
  });
});

describe("範囲の言い換え", () => {
  it("不等号のとおりに書く", () => {
    expect(describeBand(EXAMPLE[0]!)).toBe("0 ≦ x < 30");
    expect(describeBand(band("A", "0", "30", 1, "EXCLUSIVE", "INCLUSIVE"))).toBe("0 < x ≦ 30");
    expect(describeBand(band("A", "30", null, 1))).toBe("30 ≦ x");
    expect(describeBand(band("A", null, "30", 1))).toBe("x < 30");
    expect(describeBand(band("A", null, null, 1))).toBe("すべて");
  });
});
