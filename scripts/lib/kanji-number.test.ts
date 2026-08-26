import { describe, expect, it } from "vitest";
import { convertKanjiLocants, kanjiToNumber } from "./kanji-number";

describe("kanjiToNumber", () => {
  it("一桁", () => {
    expect(kanjiToNumber("一")).toBe(1);
    expect(kanjiToNumber("九")).toBe(9);
    expect(kanjiToNumber("〇")).toBe(0);
  });
  it("十まわり", () => {
    expect(kanjiToNumber("十")).toBe(10);
    expect(kanjiToNumber("十三")).toBe(13);
    expect(kanjiToNumber("二十")).toBe(20);
    expect(kanjiToNumber("四十")).toBe(40);
    expect(kanjiToNumber("三十八")).toBe(38);
  });
  it("数でないものは null", () => {
    expect(kanjiToNumber("ａ")).toBeNull();
    expect(kanjiToNumber("")).toBeNull();
    expect(kanjiToNumber("百")).toBeNull();
  });
});

describe("convertKanjiLocants", () => {
  it("区切りに挟まれた位置番号を直す", () => {
    expect(convertKanjiLocants("一・二・三・四・十・十―ヘキサクロロ")).toBe(
      "1・2・3・4・10・10―ヘキサクロロ",
    );
  });

  it("二桁の位置番号も直す", () => {
    expect(convertKanjiLocants("十三・十三・十四・十四―ドデカクロロ")).toBe(
      "13・13・14・14―ドデカクロロ",
    );
  });

  it("**語の中の漢数字は直さない**", () => {
    // ここを直すと「4塩化炭素」になってしまう
    expect(convertKanjiLocants("四塩化炭素")).toBe("四塩化炭素");
    expect(convertKanjiLocants("二硫化炭素")).toBe("二硫化炭素");
    expect(convertKanjiLocants("四アルキル鉛")).toBe("四アルキル鉛");
  });

  it("括弧の中も直す", () => {
    expect(convertKanjiLocants("ビシクロ［二・二・一］ヘプタン")).toBe(
      "ビシクロ［2・2・1］ヘプタン",
    );
  });

  it("先頭の位置番号も直す", () => {
    expect(convertKanjiLocants("二―（二Ｈ―一・二・三―ベンゾトリアゾール")).toBe(
      "2―（2Ｈ―1・2・3―ベンゾトリアゾール",
    );
  });

  it("語は変えない（ターシャリはそのまま）", () => {
    expect(convertKanjiLocants("四・六―ジ―ターシャリ―ブチルフェノール")).toBe(
      "4・6―ジ―ターシャリ―ブチルフェノール",
    );
  });

  it("〇が並ぶ形も読む", () => {
    expect(convertKanjiLocants("〇・〇八二")).toBe("0・082");
  });
});
