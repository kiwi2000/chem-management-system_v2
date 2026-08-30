import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { fillXlsx } from "@/lib/doc-fill/xlsx";
import type { FillInput } from "@/lib/doc-fill/types";

/**
 * Excel の様式に値を埋める。
 *
 * **見るのは「相手の様式が壊れないこと」。**罫線・セルの結合・下に書いてある文が
 * 明細の行数に合わせて正しく動くかどうかで、取引先へ出せるかが決まる。
 */

/** 調査票をひとつ組む。3行目が明細、5行目に結び、B列は結合されている */
async function sampleBook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("調査票");
  ws.getCell("A1").value = "製品コード";
  ws.getCell("B1").value = "{product.code}";
  ws.getCell("A2").value = "CAS番号";
  ws.getCell("B2").value = "物質名";
  ws.getCell("D2").value = "重量%";
  ws.getCell("A3").value = "{composition.casNumber}";
  ws.getCell("B3").value = "{composition.name}";
  ws.getCell("D3").value = "{composition.contentPct}";
  ws.mergeCells("B3:C3");
  ws.getCell("A3").border = { top: { style: "thin" }, bottom: { style: "thin" } };
  ws.getRow(3).height = 24;
  ws.getCell("A5").value = "以上";
  ws.mergeCells("A5:D5");
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function input(file: Buffer, rows: Record<string, string>[]): FillInput {
  return {
    file,
    target: "PRODUCT",
    values: new Map([["product.code", "PR-001"]]),
    tables: new Map([
      [
        "composition",
        {
          columns: [
            { key: "casNumber", label: "CAS" },
            { key: "name", label: "名称" },
            { key: "contentPct", label: "重量%" },
          ],
          rows,
        },
      ],
    ]),
  };
}

async function read(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("調査票")!;
  return {
    cell: (ref: string) => ws.getCell(ref).value,
    merges: (ws.model as { merges?: string[] }).merges ?? [],
    height: (n: number) => ws.getRow(n).height,
    border: (ref: string) => ws.getCell(ref).border,
  };
}

const COMPOSITION = [
  { casNumber: "7440-50-8", name: "銅", contentPct: "60" },
  { casNumber: "7440-31-5", name: "すず", contentPct: "39" },
  { casNumber: "7439-92-1", name: "鉛", contentPct: "1" },
];

describe("fillXlsx", () => {
  it("1つの値を埋める", async () => {
    const out = await fillXlsx(input(await sampleBook(), COMPOSITION));
    const s = await read(out.buffer);
    expect(s.cell("B1")).toBe("PR-001");
    expect(out.unknown).toEqual([]);
  });

  it("明細の札を置いた行が、行数ぶん増える", async () => {
    const out = await fillXlsx(input(await sampleBook(), COMPOSITION));
    const s = await read(out.buffer);
    expect(s.cell("A3")).toBe("7440-50-8");
    expect(s.cell("A4")).toBe("7440-31-5");
    expect(s.cell("A5")).toBe("7439-92-1");
    expect(s.cell("D5")).toBe("1");
    // 下に書いてあった文は、増えたぶん下がる
    expect(s.cell("A7")).toBe("以上");
  });

  it("罫線と行の高さを引き継ぐ", async () => {
    const out = await fillXlsx(input(await sampleBook(), COMPOSITION));
    const s = await read(out.buffer);
    expect(s.height(4)).toBe(24);
    expect(s.border("A4")?.top?.style).toBe("thin");
  });

  it("セルの結合を、増えた行に写し、下の結合をずらす", async () => {
    const out = await fillXlsx(input(await sampleBook(), COMPOSITION));
    const s = await read(out.buffer);
    expect(s.merges).toContain("B3:C3");
    expect(s.merges).toContain("B4:C4");
    expect(s.merges).toContain("B5:C5");
    // 5行目にあった結び。2行増えたので7行目へ
    expect(s.merges).toContain("A7:D7");
    expect(s.merges).not.toContain("A5:D5");
  });

  it("明細が0件なら、その行ごと消す", async () => {
    const out = await fillXlsx(input(await sampleBook(), []));
    const s = await read(out.buffer);
    // 3行目が消えるので、以下は1行ずつ上がる（4行目が空行、5行目が結び）
    expect(s.cell("A4")).toBe("以上");
    expect(s.merges).toContain("A4:D4");
    expect(s.merges).not.toContain("B3:C3");
  });

  it("知らない札は空にして、何が分からなかったかを返す", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("調査票");
    ws.getCell("A1").value = "担当: {product.nosuch} / {org.item.部署}";
    const file = Buffer.from(await wb.xlsx.writeBuffer());
    const out = await fillXlsx({ ...input(file, []), orgItems: ["部署"] });
    const s = await read(out.buffer);
    expect(s.cell("A1")).toBe("担当:  / ");
    expect(out.unknown).toEqual(["product.nosuch"]);
  });

  it("飾りが混ざった文字の中の札も埋める", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("調査票");
    ws.getCell("A1").value = {
      richText: [
        { text: "コード: ", font: { bold: true } },
        { text: "{product." },
        { text: "code}" },
      ],
    };
    const file = Buffer.from(await wb.xlsx.writeBuffer());
    const out = await fillXlsx(input(file, []));
    const s = await read(out.buffer);
    const v = s.cell("A1") as { richText: { text: string }[] };
    expect(v.richText.map((r) => r.text).join("")).toBe("コード: PR-001");
  });
});
