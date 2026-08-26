import { describe, expect, it } from "vitest";
import { childrenOf, findAll, isReading, nodeText, parseXml, textOf } from "./egov-xml";

describe("parseXml", () => {
  it("入れ子を木にする", () => {
    const r = parseXml("<a><b>x</b><b>y</b></a>");
    expect(findAll(r, "b").map((n) => nodeText(n))).toEqual(["x", "y"]);
  });

  it("属性を読む", () => {
    const r = parseXml('<a Num="3" Delete="false"/>');
    expect(findAll(r, "a")[0]!.attrs).toEqual({ Num: "3", Delete: "false" });
  });

  it("宣言とコメントを読み飛ばす", () => {
    const r = parseXml('<?xml version="1.0"?><!-- めも --><a>1</a>');
    expect(textOf(r, "a")).toBe("1");
  });

  it("実体参照を戻す", () => {
    expect(textOf(parseXml("<a>&lt;&amp;&#x30A2;</a>"), "a")).toBe("<&ア");
  });

  it("閉じ忘れは投げる", () => {
    expect(() => parseXml("<a><b></a>")).toThrow();
  });
});

describe("nodeText", () => {
  it("**ふりがなを落とす**", () => {
    // 落とさないと「五弗ふつ化臭素」になる
    const r = parseXml("<S>五弗<Ruby>素<Rt>ふつ</Rt></Ruby>化臭素</S>");
    expect(nodeText(r)).toBe("五弗素化臭素");
  });

  it("**上付き添字は残す**", () => {
    // 法令XMLは上付き添字もルビで書く。落とすと位置番号が消える
    const r = parseXml("<S>［五・三・〇・<Ruby>〇<Rt>二・六</Rt></Ruby>］</S>");
    expect(nodeText(r)).toBe("［五・三・〇・〇（二・六）］");
  });

  it("改行と余分な空白をまとめる", () => {
    expect(nodeText(parseXml("<a>  一\n\n  亜鉛  </a>"))).toBe("一 亜鉛");
  });
});

describe("childrenOf", () => {
  it("直下だけを拾う（入れ子の同名は拾わない）", () => {
    const r = parseXml("<t><Item>1<Item>1の1</Item></Item><Item>2</Item></t>");
    const t = findAll(r, "t")[0]!;
    expect(childrenOf(t, "Item").length).toBe(2);
    expect(findAll(t, "Item").length).toBe(3);
  });
});

describe("isReading", () => {
  it("かなだけなら読み仮名", () => {
    expect(isReading("ふつ")).toBe(true);
    expect(isReading("せん")).toBe(true);
    expect(isReading("ヒ")).toBe(true);
  });
  it("数字が混じれば上付き添字", () => {
    expect(isReading("二・六")).toBe(false);
    expect(isReading("2,6")).toBe(false);
  });
});
