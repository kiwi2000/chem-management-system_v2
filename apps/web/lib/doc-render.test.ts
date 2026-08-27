import type { DocumentContent } from "@chem/shared";
import { describe, expect, it } from "vitest";
import { renderDocument, type RenderInput } from "./doc-render";

const content = (blocks: DocumentContent["blocks"]): DocumentContent => ({
  orientation: "portrait",
  blocks,
});

const run = (
  blocks: DocumentContent["blocks"],
  values: Record<string, string> = {},
  tables: RenderInput["tables"] = new Map(),
) =>
  renderDocument({
    content: content(blocks),
    target: "PRODUCT",
    values: new Map(Object.entries(values)),
    tables,
  });

describe("差込項目を値に置き換える", () => {
  it("文中の項目が値になる", () => {
    const out = run(
      [
        {
          id: "1",
          kind: "text",
          lines: [
            {
              spans: [
                { kind: "text", text: "製品 " },
                { kind: "field", field: "product.code", bold: true },
              ],
            },
          ],
        },
      ],
      { "product.code": "PR-001" },
    );
    expect(out.blocks[0]).toEqual({
      kind: "text",
      lines: [{ spans: [{ text: "製品 " }, { text: "PR-001", bold: true }] }],
    });
  });

  it("値が無い項目は空にする。紙面に手がかりを書かない", () => {
    const out = run([
      {
        id: "1",
        kind: "text",
        lines: [{ spans: [{ kind: "field", field: "product.note" }] }],
      },
    ]);
    expect(out.blocks[0]).toEqual({ kind: "text", lines: [{ spans: [{ text: "" }] }] });
    // 値が無いだけなので、直しの知らせは出さない
    expect(out.warnings).toEqual([]);
  });

  it("対象で使えない項目は空にし、画面向けの知らせだけ返す", () => {
    const out = run([
      {
        id: "1",
        kind: "text",
        lines: [{ spans: [{ kind: "field", field: "substance.casNumber" }] }],
      },
    ]);
    expect(out.blocks[0]).toEqual({ kind: "text", lines: [{ spans: [{ text: "" }] }] });
    expect(out.warnings).toEqual(["unknownFields:substance.casNumber"]);
  });

  it("寄せと装飾を持ち越す", () => {
    const out = run([
      {
        id: "1",
        kind: "heading",
        level: 2,
        lines: [
          { align: "center", spans: [{ kind: "text", text: "題", color: "#b91c1c", size: 18 }] },
        ],
      },
    ]);
    expect(out.blocks[0]).toEqual({
      kind: "heading",
      level: 2,
      lines: [{ align: "center", spans: [{ text: "題", color: "#b91c1c", size: 18 }] }],
    });
  });
});

describe("項目の並び", () => {
  it("ラベルと値を組にする", () => {
    const out = run(
      [
        {
          id: "1",
          kind: "fields",
          items: [
            { label: "コード", field: "product.code" },
            { label: "型式", field: "product.modelName" },
          ],
        },
      ],
      { "product.code": "PR-001" },
    );
    expect(out.blocks[0]).toEqual({
      kind: "fields",
      items: [
        { label: "コード", value: "PR-001" },
        { label: "型式", value: "" },
      ],
    });
  });

  it("項目を選んでいない行は出さない", () => {
    const out = run([{ id: "1", kind: "fields", items: [{ label: "ラベルだけ", field: "" }] }]);
    expect(out.blocks[0]).toEqual({ kind: "fields", items: [] });
  });
});

describe("表", () => {
  const tables: RenderInput["tables"] = new Map([
    [
      "composition",
      {
        columns: [
          { key: "casNumber", label: "CAS番号" },
          { key: "name", label: "物質名" },
          { key: "contentPct", label: "重量%" },
        ],
        rows: [
          { casNumber: "7439-92-1", name: "鉛", contentPct: "0.5" },
          { casNumber: "7440-50-8", name: "銅", contentPct: "" },
        ],
      },
    ],
  ]);

  it("選んだ列だけを、表の定義の順で出す", () => {
    const out = run(
      [{ id: "1", kind: "table", table: "composition", columns: ["contentPct", "casNumber"] }],
      {},
      tables,
    );
    expect(out.blocks[0]).toEqual({
      kind: "table",
      head: ["CAS番号", "重量%"],
      rows: [
        ["7439-92-1", "0.5"],
        ["7440-50-8", ""],
      ],
    });
  });

  it("表題を付けられる", () => {
    const out = run(
      [
        {
          id: "1",
          kind: "table",
          table: "composition",
          columns: ["name"],
          caption: "組成一覧",
        },
      ],
      {},
      tables,
    );
    expect(out.blocks[0]).toMatchObject({ caption: "組成一覧" });
  });

  it("データが取れない表は、枠ごと出さない", () => {
    const out = run([{ id: "1", kind: "table", table: "judgement", columns: ["law"] }], {}, tables);
    expect(out.blocks).toEqual([]);
  });
});

describe("そのほかのブロック", () => {
  it("飾りのブロックはそのまま通る", () => {
    const out = run([
      { id: "1", kind: "divider" },
      { id: "2", kind: "spacer", size: "lg" },
      { id: "3", kind: "pageBreak" },
      { id: "4", kind: "signature", label: "確認者" },
    ]);
    expect(out.blocks).toEqual([
      { kind: "divider" },
      { kind: "spacer", size: "lg" },
      { kind: "pageBreak" },
      { kind: "signature", label: "確認者" },
    ]);
  });

  it("紙の向きを持ち越す", () => {
    expect(run([]).orientation).toBe("portrait");
  });
});
