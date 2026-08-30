import ExcelJS from "exceljs";
import { fillText, tableOf, type FillContext } from "@/lib/doc-fill/text";
import type { FillInput, FillResult } from "@/lib/doc-fill/types";

/**
 * Excel の様式に値を埋める。
 *
 * **預かったファイルをそのまま使う。**罫線・セルの結合・ヘッダー・ロゴは
 * 触らないので、取引先から来た調査票の形がそのまま出る。
 *
 * 明細は**札を置いた行が増える**。開始・終了の印は書かせない
 * （相手の様式にこちらの都合の行を足させないため）。
 */

/** 結合は行を増やしても付いてこないので、自分で写す・ずらす */
interface Merge {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

function parseMerge(ref: string): Merge | null {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  return {
    top: Number(m[2]),
    bottom: Number(m[4]),
    left: colNum(m[1]!),
    right: colNum(m[3]!),
  };
}

function colNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function colName(n: number): string {
  let out = "";
  let v = n;
  while (v > 0) {
    const r = (v - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    v = Math.floor((v - 1) / 26);
  }
  return out;
}

function mergeRef(m: Merge): string {
  return `${colName(m.left)}${m.top}:${colName(m.right)}${m.bottom}`;
}

/** セルの文字を読む。式・数値・日付には札を書けないので触らない */
function cellText(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("hyperlink" in v && typeof v.text === "string") return v.text;
  }
  return null;
}

/**
 * セルへ書き戻す。
 * **飾りが混ざった文字は、先頭の飾りにまとめる。**
 * Excel は途中で書式が変わると文字を切って持つので、
 * 切れ目をまたぐ札を置き換えるには一度つなげるしかない
 */
function setCellText(cell: ExcelJS.Cell, text: string) {
  const v = cell.value;
  if (v && typeof v === "object" && "richText" in v) {
    const first = v.richText[0];
    cell.value = first?.font ? { richText: [{ text, font: first.font }] } : text;
    return;
  }
  if (v && typeof v === "object" && "hyperlink" in v) {
    cell.value = { ...v, text };
    return;
  }
  cell.value = text;
}

export async function fillXlsx(input: FillInput): Promise<FillResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(input.file as unknown as ArrayBuffer);

  const ctx: FillContext = {
    target: input.target,
    values: input.values,
    ...(input.orgItems ? { orgItems: input.orgItems } : {}),
    unknown: new Set<string>(),
  };

  for (const ws of wb.worksheets) {
    fillSheet(ws, ctx, input);
  }

  const out = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(out), unknown: [...ctx.unknown] };
}

function fillSheet(ws: ExcelJS.Worksheet, ctx: FillContext, input: FillInput) {
  /*
    明細の行を先に片づける。**下から順に。**
    上から広げると、その下の行の番号が動いて、次に見る行を見失う
  */
  const detail: { row: number; table: ReturnType<typeof tableOf> }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    let table: ReturnType<typeof tableOf> = null;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (table) return;
      const text = cellText(cell);
      if (text) table = tableOf(text, ctx);
    });
    if (table) detail.push({ row: n, table });
  });

  for (const d of [...detail].reverse()) {
    const data = d.table ? input.tables.get(d.table) : undefined;
    expandRow(ws, d.row, data?.rows ?? [], d.table!, ctx);
  }

  // 残りは1つの値の札。明細の行はもう埋まっている
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const text = cellText(cell);
      if (text === null) return;
      const filled = fillText(text, ctx);
      if (filled !== text) setCellText(cell, filled);
    });
  });
}

/** 明細の札が置かれた行を、行数ぶんに広げる。0件なら行ごと消す */
function expandRow(
  ws: ExcelJS.Worksheet,
  rowNumber: number,
  rows: Record<string, string>[],
  table: NonNullable<ReturnType<typeof tableOf>>,
  ctx: FillContext,
) {
  const merges = sheetMerges(ws);
  const inRow = merges.filter((m) => m.top === rowNumber && m.bottom === rowNumber);
  const below = merges.filter((m) => m.top > rowNumber);

  if (rows.length === 0) {
    ws.spliceRows(rowNumber, 1);
    remerge(ws, inRow, [], below, rowNumber, -1);
    return;
  }

  if (rows.length > 1) ws.duplicateRow(rowNumber, rows.length - 1, true);

  rows.forEach((cells, i) => {
    const row = ws.getRow(rowNumber + i);
    row.eachCell({ includeEmpty: false }, (cell) => {
      const text = cellText(cell);
      if (text === null) return;
      const filled = fillText(text, { ...ctx, row: { table, cells } });
      if (filled !== text) setCellText(cell, filled);
    });
  });

  remerge(ws, inRow, rows, below, rowNumber, rows.length - 1);
}

function sheetMerges(ws: ExcelJS.Worksheet): Merge[] {
  const refs = (ws.model as { merges?: string[] }).merges ?? [];
  return refs.map(parseMerge).filter((m): m is Merge => m !== null);
}

/**
 * 結合をやり直す。
 * **行を増やしても結合は付いてこない**（exceljs は写しも ずらしもしない）ので、
 * 明細の行にあった結合を増えた行ぶん写し、下にあった結合をずらす
 */
function remerge(
  ws: ExcelJS.Worksheet,
  inRow: Merge[],
  rows: unknown[],
  below: Merge[],
  rowNumber: number,
  shift: number,
) {
  for (const m of below) {
    ws.unMergeCells(mergeRef(m));
    ws.mergeCells(mergeRef({ ...m, top: m.top + shift, bottom: m.bottom + shift }));
  }
  if (rows.length === 0) {
    for (const m of inRow) ws.unMergeCells(mergeRef(m));
    return;
  }
  for (let i = 1; i < rows.length; i++) {
    for (const m of inRow) {
      ws.mergeCells(mergeRef({ ...m, top: rowNumber + i, bottom: rowNumber + i }));
    }
  }
}
