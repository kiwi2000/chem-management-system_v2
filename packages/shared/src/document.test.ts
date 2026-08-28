import { describe, expect, it } from "vitest";
import {
  EMPTY_DOCUMENT,
  fieldsFor,
  groupIntoRows,
  widthPercent,
  isKnownField,
  parseDocumentContent,
  tablesFor,
  unknownFields,
  type DocumentContent,
} from "./document";

const doc = (blocks: DocumentContent["blocks"]): DocumentContent => ({
  orientation: "portrait",
  blocks,
});

describe("差込項目", () => {
  it("対象ごとに選べるものが分かれる", () => {
    const p = fieldsFor("PRODUCT").map((f) => f.key);
    const s = fieldsFor("SUBSTANCE").map((f) => f.key);
    expect(p).toContain("product.code");
    expect(p).not.toContain("substance.casNumber");
    expect(s).toContain("substance.casNumber");
    expect(s).not.toContain("product.code");
  });

  it("作成日時のような共通のものは、どちらでも選べる", () => {
    expect(isKnownField("PRODUCT", "doc.generatedAt")).toBe(true);
    expect(isKnownField("SUBSTANCE", "doc.generatedAt")).toBe(true);
  });

  it("知らない鍵は通さない", () => {
    expect(isKnownField("PRODUCT", "product.cod")).toBe(false);
  });
});

describe("表のブロック", () => {
  it("対象ごとに引ける表が分かれる", () => {
    expect(tablesFor("PRODUCT").map((t) => t.key)).toContain("judgement");
    expect(tablesFor("SUBSTANCE").map((t) => t.key)).not.toContain("judgement");
  });
});

describe("保存された中身を読む", () => {
  it("空のテンプレートを読める", () => {
    expect(parseDocumentContent(EMPTY_DOCUMENT)).toEqual(EMPTY_DOCUMENT);
  });

  it("向きが無いものは読めない", () => {
    expect(parseDocumentContent({ blocks: [] })).toBeNull();
  });

  it("知らない種類のブロックが混ざっていたら読めない", () => {
    expect(
      parseDocumentContent({ orientation: "portrait", blocks: [{ id: "a", kind: "chart" }] }),
    ).toBeNull();
  });

  it("オブジェクトでないものは読めない", () => {
    expect(parseDocumentContent("{}")).toBeNull();
    expect(parseDocumentContent(null)).toBeNull();
  });
});

describe("対象に合わない差込項目を見つける", () => {
  it("文中の差込項目を見る", () => {
    const c = doc([
      {
        id: "1",
        kind: "text",
        lines: [
          {
            spans: [
              { kind: "text", text: "製品 " },
              { kind: "field", field: "product.code" },
              { kind: "field", field: "substance.casNumber" },
            ],
          },
        ],
      },
    ]);
    expect(unknownFields(c, "PRODUCT")).toEqual(["substance.casNumber"]);
  });

  it("「ラベル：値」の並びも見る", () => {
    const c = doc([
      {
        id: "1",
        kind: "fields",
        items: [
          { label: "コード", field: "product.code" },
          { label: "誤り", field: "product.cod" },
        ],
      },
    ]);
    expect(unknownFields(c, "PRODUCT")).toEqual(["product.cod"]);
  });

  it("対象を変えると、表のブロックも合わなくなる", () => {
    const c = doc([{ id: "1", kind: "table", table: "judgement", columns: ["law"] }]);
    expect(unknownFields(c, "PRODUCT")).toEqual([]);
    expect(unknownFields(c, "SUBSTANCE")).toEqual(["table:judgement"]);
  });

  it("同じ間違いが2か所にあっても1つにまとめる", () => {
    const c = doc([
      { id: "1", kind: "fields", items: [{ label: "a", field: "nope" }] },
      { id: "2", kind: "fields", items: [{ label: "b", field: "nope" }] },
    ]);
    expect(unknownFields(c, "PRODUCT")).toEqual(["nope"]);
  });
});

describe("横に並べる", () => {
  const b = (kind: string, width?: unknown) =>
    ({ kind, width }) as unknown as Parameters<typeof groupIntoRows>[0][number];
  const n = (w: number) => b("text", w);

  it("幅を指定しなければ、1つずつ1行", () => {
    const rows = groupIntoRows([b("text"), b("text")]);
    expect(rows.map((r) => r.blocks.length)).toEqual([1, 1]);
  });

  it("半分を2つ並べると1行になる", () => {
    const rows = groupIntoRows([b("text", "half"), b("text", "half")]);
    expect(rows.map((r) => r.blocks.length)).toEqual([2]);
  });

  it("3分の1を3つで1行、4つ目は次の行", () => {
    const rows = groupIntoRows([
      b("text", "third"),
      b("text", "third"),
      b("text", "third"),
      b("text", "third"),
    ]);
    expect(rows.map((r) => r.blocks.length)).toEqual([3, 1]);
  });

  it("合計が1を超えるところで折り返す", () => {
    const rows = groupIntoRows([b("text", "twoThirds"), b("text", "half")]);
    expect(rows.map((r) => r.blocks.length)).toEqual([1, 1]);
  });

  it("全幅のブロックは、横並びを断ち切る", () => {
    const rows = groupIntoRows([b("text", "half"), b("text"), b("text", "half")]);
    expect(rows.map((r) => r.blocks.length)).toEqual([1, 1, 1]);
  });

  it("改ページは幅を持たせても1行を占める", () => {
    const rows = groupIntoRows([b("text", "half"), b("pageBreak", "half"), b("text", "half")]);
    expect(rows.map((r) => r.blocks[0]?.kind)).toEqual(["text", "pageBreak", "text"]);
  });

  it("元の位置を持ち越す。並べ替えがこの番号で動く", () => {
    const rows = groupIntoRows([b("text", "half"), b("text", "half"), b("text")]);
    expect(rows.map((r) => r.index)).toEqual([[0, 1], [2]]);
  });

  it("昔の名前も、いまの％として読める", () => {
    expect(widthPercent("full")).toBe(100);
    expect(widthPercent("half")).toBe(50);
    expect(widthPercent(undefined)).toBe(100);
    expect(widthPercent(40)).toBe(40);
    expect(widthPercent("auto")).toBeNull();
  });

  it("％で並べられる", () => {
    const rows = groupIntoRows([n(40), n(40)]);
    expect(rows.map((r) => r.percents)).toEqual([[40, 40]]);
  });

  it("100%を超えるところで折り返す", () => {
    const rows = groupIntoRows([n(60), n(60)]);
    expect(rows.map((r) => r.blocks.length)).toEqual([1, 1]);
  });
});

describe("読めない幅", () => {
  it("通らない値は落として、全幅として扱う", () => {
    const c = parseDocumentContent({
      orientation: "portrait",
      blocks: [{ id: "a", kind: "text", lines: [], width: 999 }],
    });
    expect(c).not.toBeNull();
    expect(c!.blocks[0]!.width).toBeUndefined();
  });

  it("使える値はそのまま残る", () => {
    const c = parseDocumentContent({
      orientation: "portrait",
      blocks: [
        { id: "a", kind: "text", lines: [], width: 40 },
        { id: "b", kind: "text", lines: [], width: "auto" },
        { id: "c", kind: "text", lines: [], width: "half" },
      ],
    });
    expect(c!.blocks.map((x) => x.width)).toEqual([40, "auto", "half"]);
  });
});

describe("均等", () => {
  const b = (kind: string, width?: unknown) =>
    ({ kind, width }) as unknown as Parameters<typeof groupIntoRows>[0][number];
  const auto = () => b("text", "auto");
  const n = (w: number) => b("text", w);

  it("均等どうしを等分する", () => {
    const rows = groupIntoRows([auto(), auto(), auto()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.percents).toEqual([100 / 3, 100 / 3, 100 / 3]);
  });

  it("決まっている幅の残りを分け合う", () => {
    const rows = groupIntoRows([n(40), auto(), auto()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.percents).toEqual([40, 30, 30]);
  });

  it("均等が1つなら、残りをすべて取る", () => {
    const rows = groupIntoRows([n(30), auto()]);
    expect(rows[0]!.percents).toEqual([30, 70]);
  });

  it("すでに100%埋まっていたら、均等は次の行へ", () => {
    const rows = groupIntoRows([n(50), n(50), auto()]);
    expect(rows.map((r) => r.blocks.length)).toEqual([2, 1]);
    expect(rows[1]!.percents).toEqual([100]);
  });

  it("改行は、幅が余っていても横並びを終わらせる", () => {
    const rows = groupIntoRows([n(30), n(30), b("rowBreak"), n(40), auto()]);
    expect(rows.map((r) => r.blocks.map((x) => x.kind))).toEqual([
      ["text", "text"],
      ["rowBreak"],
      ["text", "text"],
    ]);
    expect(rows[2]!.percents).toEqual([40, 60]);
  });

  it("全幅は均等の並びも断ち切る", () => {
    const rows = groupIntoRows([auto(), b("text", 100), auto()]);
    expect(rows.map((r) => r.blocks.length)).toEqual([1, 1, 1]);
  });
});
