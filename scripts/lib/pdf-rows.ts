/**
 * PDF を「行 × 欄」で読む。
 *
 * **`pdftotext -layout` を使わない。**
 * 中国の優先控制化学品名録（第二批）で、CAS の欄が1行ずれて出た。
 * 表の縦位置がそろっていない箇所を、文字の並び順だけで組み直そうとして失敗する。
 *
 * ```
 * pdftotext -layout            座標で読む
 *   （空行）    75-35-4         PC023  1,1-二氯乙烯  75-35-4   ← 正しい
 *   PC023 1,1-二氯乙烯 78-87-5   PC024  1,2-二氯丙烷  78-87-5
 * ```
 *
 * ここでは **y座標で行にまとめ、x座標を残す**。
 * 欄の切り分けは呼ぶ側が x の範囲で決める（表ごとに欄の位置が違うため）。
 */
import { readFileSync } from "node:fs";

export interface PdfWord {
  /** 左端の位置。**欄の切り分けに使う** */
  x: number;
  text: string;
}

export interface PdfRow {
  page: number;
  /** 下からの高さ。大きいほど上 */
  y: number;
  words: PdfWord[];
}

/**
 * y が近いものを同じ行とみなす幅。
 *
 * **小さすぎると1行が割れる。**中国の表は結合セルの中で
 * 数ポイントずれることがあり、3 だと割れて 8 だとちょうど収まった。
 */
const ROW_TOLERANCE = 8;

/** ページを読んで行にまとめる。`pages` を省くと全ページ */
export async function readPdfRows(path: string, pages?: number[]): Promise<PdfRow[]> {
  // pdfjs は ESM。CommonJS から読むので動的に取り込む
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({
    data: new Uint8Array(readFileSync(path)),
    useSystemFonts: true,
  }).promise;

  const out: PdfRow[] = [];
  const list = pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);
  for (const n of list) {
    const content = await (await doc.getPage(n)).getTextContent();
    const words: (PdfWord & { y: number })[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const text = item.str.trim();
      if (text === "") continue;
      words.push({
        x: Math.round(item.transform[4]),
        y: Math.round(item.transform[5]),
        text,
      });
    }
    // 上から下、左から右
    words.sort((a, b) => b.y - a.y || a.x - b.x);

    let cur: PdfRow | null = null;
    for (const w of words) {
      if (cur === null || Math.abs(w.y - cur.y) > ROW_TOLERANCE) {
        cur = { page: n, y: w.y, words: [] };
        out.push(cur);
      }
      cur.words.push({ x: w.x, text: w.text });
    }
  }
  // 行の中を x 順にそろえ直す（y のゆらぎで前後することがある）
  for (const r of out) r.words.sort((a, b) => a.x - b.x);
  return out;
}

/** x の範囲にある語をつなぐ。範囲の外は捨てる */
export function column(row: PdfRow, from: number, to: number): string {
  return row.words
    .filter((w) => w.x >= from && w.x < to)
    .map((w) => w.text)
    .join("")
    .trim();
}
