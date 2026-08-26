import { describe, expect, it } from "vitest";
import { convertNumerals, dropReferences, toDisplayName } from "./law-name";

describe("convertNumerals", () => {
  it("位置番号を直す", () => {
    expect(convertNumerals("一・二・三・四―ヘキサクロロ")).toBe("１・２・３・４―ヘキサクロロ");
  });

  it("位取りのある数を直す", () => {
    expect(convertNumerals("十から十三まで")).toBe("１０から１３まで");
    expect(convertNumerals("四十八パーセント")).toBe("４８パーセント");
    expect(convertNumerals("百三十四号")).toBe("１３４号");
  });

  it("**語の一部は直さない**", () => {
    // 「４アルキル鉛」「２硫化炭素」になってしまう
    expect(convertNumerals("四アルキル鉛")).toBe("四アルキル鉛");
    expect(convertNumerals("二硫化炭素")).toBe("二硫化炭素");
    expect(convertNumerals("四塩化炭素")).toBe("四塩化炭素");
    expect(convertNumerals("一酸化炭素")).toBe("一酸化炭素");
    expect(convertNumerals("三酸化二アンチモン")).toBe("三酸化二アンチモン");
    // 「価」は数量に見えるが、慣用として漢数字で書く
    expect(convertNumerals("六価クロム化合物")).toBe("六価クロム化合物");
    expect(convertNumerals("クロム及び三価クロム化合物")).toBe("クロム及び三価クロム化合物");
  });

  it("数量なら漢字・カタカナが続いても直す", () => {
    expect(convertNumerals("炭素数が八のものに限る")).toBe("炭素数が８のものに限る");
    expect(convertNumerals("塩素数が二以上")).toBe("塩素数が２以上");
    expect(convertNumerals("容量一リツトル以下")).toBe("容量１リツトル以下");
  });

  it("**先頭のゼロを落とさない**", () => {
    // 「〇・〇〇八二」は 0.0082。桁に意味がある
    expect(convertNumerals("〇・〇〇八二")).toBe("０・００８２");
  });
});

describe("dropReferences", () => {
  it("条文の中での呼び名を落とす", () => {
    expect(dropReferences("（別名ＰＦＯＳ。以下「ＰＦＯＳ」という。）")).toBe("（別名ＰＦＯＳ）");
  });

  it("他条への参照を落とす", () => {
    expect(
      dropReferences("（別名アルドリン。第七条の表三の項において「アルドリン」という。）"),
    ).toBe("（別名アルドリン）");
  });

  it("参照だけの括弧はまるごと落とす", () => {
    expect(
      dropReferences("ペルフルオロオクタン酸関連物質（次に掲げる化学物質をいう。以下同じ。）"),
    ).toBe("ペルフルオロオクタン酸関連物質");
  });

  it("残る部分はそのまま", () => {
    expect(
      dropReferences("（構造が分枝であつて、炭素数が八のものに限る。次号ハにおいて同じ。）"),
    ).toBe("（構造が分枝であつて、炭素数が八のものに限る。）");
  });
});

describe("toDisplayName", () => {
  it("位置番号・区切り・ダッシュをまとめて直す", () => {
    expect(toDisplayName("ヘキサクロロブタ―一・三―ジエン")).toBe(
      "ヘキサクロロブタ－１，３－ジエン",
    );
  });

  it("**角括弧の中はピリオド**（von Baeyer 命名）", () => {
    expect(toDisplayName("ポリクロロ―二・二―ジメチルビシクロ［二・二・一］ヘプタン")).toBe(
      "ポリクロロ－２，２－ジメチルビシクロ［２．２．１］ヘプタン",
    );
  });

  it("上付き添字も算用数字にする", () => {
    expect(toDisplayName("ペンタシクロ［五・三・〇・〇（二・六）］デカン")).toBe(
      "ペンタシクロ［５．３．０．０（２，６）］デカン",
    );
  });

  it("プライムをアポストロフィにする", () => {
    expect(toDisplayName("Ｎ・Ｎ′―ジトリル―パラ―フェニレンジアミン")).toBe(
      "Ｎ，Ｎ’－ジトリル－パラ－フェニレンジアミン",
    );
  });

  it("**語は変えない**", () => {
    // ターシャリを tert に、アルファを α にはしない（第3章）
    expect(toDisplayName("四・六―ジ―ターシャリ―ブチルフェノール")).toBe(
      "４，６－ジ－ターシャリ－ブチルフェノール",
    );
    expect(toDisplayName("（別名アルファ―ヘキサクロロシクロヘキサン）")).toBe(
      "（別名アルファ－ヘキサクロロシクロヘキサン）",
    );
  });

  it("四アルキル鉛は壊さない", () => {
    expect(toDisplayName("四アルキル鉛")).toBe("四アルキル鉛");
  });
});
