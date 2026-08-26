import { describe, expect, it } from "vitest";
import { itemNumber, kanjiCount, subitemNumber } from "./kanji-count";

describe("kanjiCount", () => {
  it("一桁と十まわり", () => {
    expect(kanjiCount("一")).toBe(1);
    expect(kanjiCount("十")).toBe(10);
    expect(kanjiCount("三十八")).toBe(38);
  });
  it("百まわり", () => {
    expect(kanjiCount("百")).toBe(100);
    expect(kanjiCount("百三十四")).toBe(134);
    expect(kanjiCount("五百十五")).toBe(515);
    expect(kanjiCount("四百六十四")).toBe(464);
  });
  it("**位取りの字が無いときは数字の並び**（別表の枝番）", () => {
    // 縦書きの書き方。「一〇」は 10 で、位取りとして読むと 0 になる
    expect(kanjiCount("一〇")).toBe(10);
    expect(kanjiCount("二九")).toBe(29);
    expect(kanjiCount("一一")).toBe(11);
  });

  it("数でないものは null", () => {
    expect(kanjiCount("備考")).toBeNull();
    expect(kanjiCount("")).toBeNull();
  });
});

describe("itemNumber", () => {
  it("ふつうの号", () => {
    expect(itemNumber("百三十四")).toBe("134");
  });
  it("**枝番は潰さない**", () => {
    // 19号と19の4号は別のもの
    expect(itemNumber("十九の四")).toBe("19-4");
    expect(itemNumber("十九")).toBe("19");
  });
  it("括弧付きも読む", () => {
    expect(itemNumber("（三）")).toBe("3");
  });
});

describe("subitemNumber", () => {
  it("算用数字の細目を読む", () => {
    expect(subitemNumber("１")).toBe("1");
    expect(subitemNumber("３６")).toBe("36");
  });
  it("**枝番は潰さない**", () => {
    expect(subitemNumber("３の２")).toBe("3-2");
    expect(subitemNumber("１９の４")).toBe("19-4");
  });
  it("数でないものは null", () => {
    expect(subitemNumber("備考")).toBeNull();
    expect(subitemNumber("")).toBeNull();
  });
});
