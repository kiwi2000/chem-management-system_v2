import { describe, expect, it } from "vitest";
import { bareNumber, statutoryNumber } from "./statutory-number";

describe("statutoryNumber", () => {
  it("法律の別表", () => {
    expect(statutoryNumber({ kind: "lawTable", table: "1" }, "1")).toBe("法別表第1の1");
    expect(statutoryNumber({ kind: "lawTable", table: "2" }, "87")).toBe("法別表第2の87");
  });

  it("政令の条", () => {
    expect(statutoryNumber({ kind: "orderArticle", table: "1" }, "1")).toBe("令第1条第1号");
    // 枝番の付いた条（水濁法の指定物質は第3条の3）
    expect(statutoryNumber({ kind: "orderArticle", table: "3の3" }, "55")).toBe("令第3の3条第55号");
  });

  it("項のある条（安衛法の製造禁止は第16条第1項）", () => {
    expect(statutoryNumber({ kind: "orderArticle", table: "16", paragraph: "1" }, "4")).toBe(
      "令第16条第1項第4号",
    );
  });

  it("政令の別表", () => {
    expect(statutoryNumber({ kind: "orderTable", table: "1" }, "515")).toBe("令別表第1の515");
    // 枝番の付いた別表（有機溶剤は別表第六の二）
    expect(statutoryNumber({ kind: "orderTable", table: "6の2" }, "1")).toBe("令別表第6の2の1");
  });

  it("**政令の別表の、号の下の細目**", () => {
    // 特化則の第1類は「令別表第三 第一号 の6」
    expect(statutoryNumber({ kind: "orderTableItem", table: "3", item: "1" }, "6")).toBe(
      "令別表第3第1号の6",
    );
    expect(statutoryNumber({ kind: "orderTableItem", table: "3", item: "2" }, "3-2")).toBe(
      "令別表第3第2号の3-2",
    );
  });

  it("省令の別表", () => {
    expect(statutoryNumber({ kind: "ordinanceTable", table: "2" }, "1552")).toBe("則別表第2の1552");
  });

  it("出典が1つのものはそのまま", () => {
    expect(statutoryNumber({ kind: "plain" }, "5-7143")).toBe("5-7143");
  });

  it("**同じ枝番でも出典が違えば別の番号になる**", () => {
    // これが目的。毒劇法は法の別表と指定令の両方に1号がある
    const a = statutoryNumber({ kind: "lawTable", table: "1" }, "1");
    const b = statutoryNumber({ kind: "orderArticle", table: "1" }, "1");
    expect(a).not.toBe(b);
  });
});

describe("bareNumber", () => {
  it("枝番だけを取り出す", () => {
    expect(bareNumber("法別表第1の1")).toBe("1");
    expect(bareNumber("則別表第2の1552")).toBe("1552");
    expect(bareNumber("令第1条第1号")).toBe("1");
    expect(bareNumber("令別表第3第1号の6")).toBe("6");
  });
});
