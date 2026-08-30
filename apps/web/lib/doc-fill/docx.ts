import JSZip from "jszip";
import { fillText, tableOf, type FillContext } from "@/lib/doc-fill/text";
import type { FillInput, FillResult } from "@/lib/doc-fill/types";

/**
 * Word の様式に値を埋める。
 *
 * **預かったファイルをそのまま使う。**見出し・ヘッダー・ページ番号・図は触らない。
 * 明細は Excel と同じ考えで、**札を置いた表の行が、明細の数だけ増える**。
 *
 * Word は**同じ文の中でも書式が変わると文字を切って持つ**ので、
 * 札が切れ目をまたいでいることがある。切れ目をまたぐときだけ、
 * その段落の文字をつないでから置き換える（つないだぶんの飾りは先頭に寄る）
 */

/** 値を埋めるファイル。本文のほか、ヘッダー・フッターにも差出人などを置ける */
const PART_RE = /^word\/(document|header\d*|footer\d*)\.xml$/;

export async function fillDocx(input: FillInput): Promise<FillResult> {
  const zip = await JSZip.loadAsync(input.file);
  const ctx: FillContext = {
    target: input.target,
    values: input.values,
    ...(input.orgItems ? { orgItems: input.orgItems } : {}),
    unknown: new Set<string>(),
  };

  for (const name of Object.keys(zip.files)) {
    if (!PART_RE.test(name)) continue;
    const xml = await zip.file(name)!.async("string");
    zip.file(name, fillPart(xml, ctx, input));
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, unknown: [...ctx.unknown] };
}

/** 1つのXMLを、表の行 → 段落 の順に片づける */
function fillPart(xml: string, ctx: FillContext, input: FillInput): string {
  return fillParagraphs(expandRows(xml, ctx, input), ctx);
}

/* ------------------------------------------------------------------ *
   表の行
 * ------------------------------------------------------------------ */

/**
 * 表の行を切り出す。**入れ子の表があるので、深さを数える。**
 * `<w:tr>` の中にまた表が入っていることがあり、最初に出てくる `</w:tr>` は
 * 内側のものかもしれない
 */
function findRows(xml: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const token = /<w:tr(?=[ >])[^>]*>|<\/w:tr>/g;
  let depth = 0;
  let start = -1;
  for (const m of xml.matchAll(token)) {
    if (m[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push({ start, end: m.index + m[0].length });
        start = -1;
      }
    } else {
      if (depth === 0) start = m.index;
      depth += 1;
    }
  }
  return out;
}

/** 明細の札がある行を、行数ぶんに増やす。0件なら行ごと消す */
function expandRows(xml: string, ctx: FillContext, input: FillInput): string {
  const rows = findRows(xml);
  let out = xml;
  // 後ろから直す。前から直すと、後ろの行の位置がずれる
  for (const r of [...rows].reverse()) {
    const block = out.slice(r.start, r.end);
    const table = tableOf(textOf(block), ctx);
    if (!table) continue;
    const data = input.tables.get(table)?.rows ?? [];
    const filled = data
      .map((cells) => fillParagraphs(block, { ...ctx, row: { table, cells } }))
      .join("");
    out = out.slice(0, r.start) + filled + out.slice(r.end);
  }
  return out;
}

/* ------------------------------------------------------------------ *
   段落
 * ------------------------------------------------------------------ */

/** 文字を持つ箱。`<w:t>` の中身だけを見る（属性の中には札を書けない） */
const TEXT_RE = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;
const PARA_RE = /<w:p(?=[ >])[\s\S]*?<\/w:p>/g;

/** その塊に書かれている文字。札があるかどうかを見るために使う */
function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(TEXT_RE)) out += unescapeXml(m[2] ?? "");
  return out;
}

function fillParagraphs(xml: string, ctx: FillContext): string {
  return xml.replace(PARA_RE, (para) => fillParagraph(para, ctx));
}

function fillParagraph(para: string, ctx: FillContext): string {
  if (!para.includes("{")) return para;

  // まずは箱ごとに。**飾りが残るので、こちらを先に試す**
  let out = para.replace(TEXT_RE, (whole, open: string, body: string, close: string) => {
    const text = unescapeXml(body);
    const filled = fillText(text, ctx);
    return filled === text ? whole : preserve(open) + escapeXml(filled) + close;
  });

  // 箱をまたいでいる札が残っていたら、つないでから置き換える
  if (/\{[^{}]*$/.test(textOf(out)) || textOf(out).includes("{")) {
    const joined = textOf(out);
    const filled = fillText(joined, ctx);
    if (filled !== joined) {
      let first = true;
      out = out.replace(TEXT_RE, (_whole, open: string, _body: string, close: string) => {
        const body = first ? escapeXml(filled) : "";
        first = false;
        return preserve(open) + body + close;
      });
    }
  }
  return out;
}

/** 前後の空白を落とされないようにする。Word は指定が無いと詰めてしまう */
function preserve(open: string): string {
  return open.includes("xml:space") ? open : open.replace(/>$/, ' xml:space="preserve">');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
