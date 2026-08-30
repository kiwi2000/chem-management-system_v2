import { TEMPLATE_MIME, type FileKind } from "@/lib/doc-fill";

/**
 * ファイルを落とすときの返しかた。
 *
 * **名前は2通りで渡す。**日本語の名前は古い決まりでは送れないので、
 * 読める形（`filename*`）を添える。片方だけだと、
 * 機械によっては文字化けした名前で保存される
 */
export function fileResponse(buf: Buffer, name: string, kind: FileKind): Response {
  // 見出しに書けない字は落とす。引用符と区切りが混ざると、そこで名前が切れる
  let ascii = "";
  for (const ch of name) {
    const c = ch.codePointAt(0) ?? 0;
    ascii += c >= 0x20 && c <= 0x7e && ch !== '"' && ch !== ";" && ch !== "\\" ? ch : "_";
  }
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": TEMPLATE_MIME[kind],
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
