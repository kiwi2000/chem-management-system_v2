/**
 * 表（TSV / CSV）の読み書き。Excel が保存するものをそのまま受け付ける。
 *
 * - 先頭の BOM は捨てる。改行は CRLF / LF どちらでも
 * - 区切りはタブが基本。1 行目にタブが無くカンマがあれば CSV とみなす
 * - Excel はセルに区切り・引用符・改行があると "…" で囲み、中の " は "" にする。それを戻す
 * - 空行は飛ばす
 * DB には触らない（純粋な関数。テストは tsv.test.ts）
 */

export type Delimiter = "\t" | ",";

export interface ParsedTable {
  delimiter: Delimiter;
  /** 1 行目（前後の空白を落としたもの） */
  header: string[];
  /** 2 行目以降。header と同じ長さにそろえる（足りない列は ""） */
  rows: string[][];
  /** 元ファイルでの行番号（1 始まり。空行を飛ばした分ずれるので持っておく） */
  lineNumbers: number[];
}

/** 1 行目から区切り文字を決める */
export function detectDelimiter(firstLine: string): Delimiter {
  if (firstLine.includes("\t")) return "\t";
  if (firstLine.includes(",")) return ",";
  return "\t";
}

/** 1 行を区切る（"…" の中の区切り・改行は区切りとみなさない） */
function splitLine(line: string, delimiter: Delimiter): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"' && cur === "") {
      quoted = true;
    } else if (c === delimiter) {
      cells.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

/**
 * 引用符の中の改行をまたぐ行をつなぐ。
 * "…" が閉じていない行は、次の行と改行でつないで 1 行にする
 */
function joinQuotedLines(lines: string[]): { text: string; lineNo: number }[] {
  const out: { text: string; lineNo: number }[] = [];
  let buf: string | null = null;
  let bufNo = 0;
  const quoteCount = (s: string) => (s.match(/"/g) ?? []).length;
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\r$/, "");
    if (buf === null) {
      if (quoteCount(line) % 2 === 1) {
        buf = line;
        bufNo = idx + 1;
      } else {
        out.push({ text: line, lineNo: idx + 1 });
      }
    } else {
      buf += "\n" + line;
      if (quoteCount(line) % 2 === 1) {
        out.push({ text: buf, lineNo: bufNo });
        buf = null;
      }
    }
  });
  if (buf !== null) out.push({ text: buf, lineNo: bufNo });
  return out;
}

export function parseTable(text: string): ParsedTable {
  const body = text.replace(/^\uFEFF/, "");
  const physical = body.split("\n");
  const logical = joinQuotedLines(physical).filter((l) => l.text.trim() !== "");
  if (logical.length === 0) return { delimiter: "\t", header: [], rows: [], lineNumbers: [] };
  const delimiter = detectDelimiter(logical[0]!.text);
  const header = splitLine(logical[0]!.text, delimiter).map((h) => h.trim());
  const rows: string[][] = [];
  const lineNumbers: number[] = [];
  for (const l of logical.slice(1)) {
    const cells = splitLine(l.text, delimiter).map((c) => c.trim());
    while (cells.length < header.length) cells.push("");
    rows.push(cells.slice(0, header.length));
    lineNumbers.push(l.lineNo);
  }
  return { delimiter, header, rows, lineNumbers };
}

/** 1 セルを書く。区切り・引用符・改行を含むときだけ "…" で囲む（Excel と同じ） */
export function quoteCell(
  v: string | number | boolean | null | undefined,
  delimiter: Delimiter = "\t",
): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(delimiter) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * 表を書く。**先頭に BOM を付ける**（Excel が UTF-8 と分かるように）。改行は CRLF（Windows で開くため）
 */
export function writeTable(
  header: string[],
  rows: (string | number | boolean | null | undefined)[][],
  delimiter: Delimiter = "\t",
): string {
  const lines = [header.map((h) => quoteCell(h, delimiter)).join(delimiter)];
  for (const r of rows) lines.push(r.map((c) => quoteCell(c, delimiter)).join(delimiter));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
