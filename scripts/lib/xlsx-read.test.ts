import { describe, expect, it } from "vitest";
// @ts-expect-error 圧縮の解凍を素の Node だけで書いてあるため .mjs
import { parseSheetXml, sharedText } from "./xlsx-read.mjs";

describe("parseSheetXml", () => {
  /*
    **空の欄でうしろがずれないこと。**厚生労働省の一覧は空の欄を書き出さず、
    `<c r="D9" s="22"/>` の形で置く。ここを取り違えると、裾切値の欄に
    適用日が入るなど、値が1つずつ横へずれる
  */
  it("空の欄があっても、値が列の位置どおりに並ぶ", () => {
    const xml =
      '<row r="9"><c r="A9" t="s"><v>0</v></c><c r="D9" s="22"/>' +
      '<c r="F9" t="s"><v>1</v></c><c r="H9"><v>0.1</v></c></row>';
    expect(parseSheetXml(xml, ["50-32-8", "●"])).toEqual([
      ["50-32-8", "", "", "", "", "●", "", "0.1"],
    ]);
  });

  it("文字列と数値を読み分ける", () => {
    const xml = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>45383</v></c></row>';
    expect(parseSheetXml(xml, ["CAS RN"])).toEqual([["CAS RN", "45383"]]);
  });

  it("文字が直接入っている欄（inlineStr）も読む", () => {
    const xml = '<row r="1"><c r="A1" t="inlineStr"><is><t>ベンゼン</t></is></c></row>';
    expect(parseSheetXml(xml, [])).toEqual([["ベンゼン"]]);
  });
});

describe("sharedText", () => {
  /*
    **ふりがなを本文に混ぜないこと。**厚生労働省の一覧は見出しにふりがなを持っており、
    混ぜると「令和５年度レイワネンド」のようになって、値の突き合わせが外れる
  */
  it("ふりがな（rPh）を落とす", () => {
    const si = '<r><t>令和５年度</t></r><rPh sb="0" eb="5"><t>レイワネンド</t></rPh>';
    expect(sharedText(si)).toBe("令和５年度");
  });

  it("分かれている本文はつなぐ", () => {
    expect(sharedText("<r><t>ベンゼ</t></r><r><t>ン</t></r>")).toBe("ベンゼン");
  });
});
