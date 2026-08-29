/**
 * xlsx を読む。**外の部品は入れない。**
 * xlsx は zip の中に XML が入っているだけなので、標準の zlib で足りる。
 * ここで必要なのは「シートを行と列の文字列にする」ことだけ。
 */
import { inflateRawSync } from "node:zlib";

function unzip(buf) {
  const files = new Map();
  let p = buf.length - 22;
  while (p > 0 && buf.readUInt32LE(p) !== 0x06054b50) p--;
  const count = buf.readUInt16LE(p + 10);
  let off = buf.readUInt32LE(p + 16);
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    const method = buf.readUInt16LE(off + 10);
    const size = buf.readUInt32LE(off + 20);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files.set(name, method === 0 ? raw : inflateRawSync(raw));
    off += 46 + nameLen + extraLen + commLen;
  }
  return files;
}

const unescape = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * 共有文字列を1つ読む。
 *
 * **ふりがなは本文ではない。**Excel は `<rPh>` にふりがなを持ち、そこにも `<t>` がある。
 * まとめて拾うと「令和５年度レイワネンド」のように後ろにくっつく
 */
export function sharedText(si) {
  const body = si.replace(/<rPh[\s\S]*?<\/rPh>/g, "");
  return unescape([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
}

/** 1枚目のシートを、行ごとの文字列の配列にして返す */
export function readSheet(buf) {
  const files = unzip(buf);
  const sharedXml = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => sharedText(m[1]));
  const sheet = files.get("xl/worksheets/sheet1.xml").toString("utf8");
  return parseSheetXml(sheet, shared);
}

/**
 * シートの XML を、行ごとの文字列の配列にする。
 * 圧縮の外側と切り離してあるのは、ここだけを試せるようにするため
 */
export function parseSheetXml(sheet, shared) {
  return [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const out = [];
    /*
      **属性は控えめに読む。**`[^>]*` だと `<c r="D9" s="22"/>` の `/` まで
      属性に取り込んでしまい、続きを次の `</c>` まで飲み込む。
      空の欄のうしろが1つずれる（厚生労働省の一覧で、裾切値の欄に別の値が入った）
    */
    for (const c of row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? "";
      const t = /t="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? "")?.[1];
      /*
        **空の欄は書き出されない。**順に詰めていくと、途中が空いている行で
        あとの欄が左へずれる（厚生労働省の一覧で、裾切値の欄に適用日が入った）。
        `r="C5"` の列名を数に直して、その位置へ置く
      */
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      let at = out.length;
      if (ref) {
        at = 0;
        for (const ch of ref) at = at * 26 + (ch.charCodeAt(0) - 64);
        at -= 1;
      }
      while (out.length < at) out.push("");
      if (v === undefined) {
        // 文字列が直接入っている形（t="inlineStr"）にも備える
        const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c[2] ?? "")?.[1];
        out[at] = inline ? unescape(inline) : "";
        continue;
      }
      out[at] = t === "s" ? (shared[Number(v)] ?? "") : unescape(v);
    }
    return out;
  });
}
