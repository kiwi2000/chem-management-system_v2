import type { RichLine } from "@chem/shared";
import { describe, expect, it } from "vitest";
import { FIELD_NODE, fromEditor, isEmptyLines, toEditor, type PmNode } from "./doc-rich-text";

const para = (content: PmNode[], attrs?: Record<string, unknown>): PmNode => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content,
});
const doc = (content: PmNode[]): PmNode => ({ type: "doc", content });

describe("エディタの形から、保存する形へ", () => {
  it("素の文字を読む", () => {
    expect(fromEditor(doc([para([{ type: "text", text: "こんにちは" }])]))).toEqual([
      { spans: [{ kind: "text", text: "こんにちは" }] },
    ]);
  });

  it("太字・斜体・下線を読む", () => {
    const n: PmNode = {
      type: "text",
      text: "強調",
      marks: [{ type: "bold" }, { type: "italic" }, { type: "underline" }],
    };
    expect(fromEditor(doc([para([n])]))[0]?.spans[0]).toEqual({
      kind: "text",
      text: "強調",
      bold: true,
      italic: true,
      underline: true,
    });
  });

  it("色と大きさを読む", () => {
    const n: PmNode = {
      type: "text",
      text: "赤",
      marks: [{ type: "textStyle", attrs: { color: "#FF0000", fontSize: "18pt" } }],
    };
    expect(fromEditor(doc([para([n])]))[0]?.spans[0]).toEqual({
      kind: "text",
      text: "赤",
      color: "#ff0000",
      size: 18,
    });
  });

  it("色や大きさの書き方が違うものは、指定なしとして読む", () => {
    const n: PmNode = {
      type: "text",
      text: "x",
      marks: [{ type: "textStyle", attrs: { color: "red", fontSize: "1.2em" } }],
    };
    expect(fromEditor(doc([para([n])]))[0]?.spans[0]).toEqual({ kind: "text", text: "x" });
  });

  it("知らない印は落とす", () => {
    const n: PmNode = { type: "text", text: "x", marks: [{ type: "highlight" }] };
    expect(fromEditor(doc([para([n])]))[0]?.spans[0]).toEqual({ kind: "text", text: "x" });
  });

  it("差込項目を読む", () => {
    const n: PmNode = { type: FIELD_NODE, attrs: { field: "product.code" } };
    expect(fromEditor(doc([para([n])]))[0]?.spans[0]).toEqual({
      kind: "field",
      field: "product.code",
    });
  });

  it("鍵の無い差込項目は落とす", () => {
    const n: PmNode = { type: FIELD_NODE, attrs: {} };
    expect(fromEditor(doc([para([n])]))[0]?.spans).toEqual([]);
  });

  it("寄せを読む。左寄せは持たない（既定なので）", () => {
    expect(fromEditor(doc([para([], { textAlign: "center" })]))[0]?.align).toBe("center");
    expect(fromEditor(doc([para([], { textAlign: "left" })]))[0]?.align).toBeUndefined();
  });

  it("段落が無くても1行は返す", () => {
    expect(fromEditor(doc([]))).toEqual([{ spans: [] }]);
    expect(fromEditor(null)).toEqual([{ spans: [] }]);
  });
});

describe("保存する形から、エディタの形へ", () => {
  it("素の文字を戻す", () => {
    expect(toEditor([{ spans: [{ kind: "text", text: "あ" }] }])).toEqual(
      doc([para([{ type: "text", text: "あ" }])]),
    );
  });

  it("空文字は節点にしない", () => {
    expect(toEditor([{ spans: [{ kind: "text", text: "" }] }])).toEqual(
      doc([{ type: "paragraph" }]),
    );
  });

  it("差込項目を戻す", () => {
    expect(toEditor([{ spans: [{ kind: "field", field: "product.code" }] }])).toEqual(
      doc([para([{ type: FIELD_NODE, attrs: { field: "product.code" } }])]),
    );
  });
});

describe("行き来しても中身が変わらない", () => {
  it("装飾と差込項目が混ざった行", () => {
    const lines: RichLine[] = [
      {
        align: "center",
        spans: [
          { kind: "text", text: "製品 ", bold: true },
          { kind: "field", field: "product.code", color: "#0055aa", size: 12 },
          { kind: "text", text: " の報告書", underline: true },
        ],
      },
      { spans: [{ kind: "text", text: "2行目" }] },
    ];
    expect(fromEditor(toEditor(lines))).toEqual(lines);
  });
});

describe("空かどうか", () => {
  it("空白だけなら空とみなす", () => {
    expect(isEmptyLines([{ spans: [{ kind: "text", text: "  " }] }])).toBe(true);
    expect(isEmptyLines([{ spans: [] }])).toBe(true);
  });

  it("差込項目があれば空ではない", () => {
    expect(isEmptyLines([{ spans: [{ kind: "field", field: "product.code" }] }])).toBe(false);
  });
});
