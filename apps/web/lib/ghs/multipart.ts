/**
 * multipart/form-data の簡単な読み手。
 *
 * Next.js（undici）の `req.formData()` は、10 MB ほどのファイルを含むと
 * 「expected boundary after body」で落ちる（Node 24 / Next 15 で実際に起きた。NITE の根拠一覧が 10.8 MB）。
 * 本文は 32 MB までと決めているので、丸ごと読んで境界で切る素朴な実装で足りる。
 * 入れ子の multipart や quoted-printable は扱わない（ブラウザの FormData と curl が作る形だけ）
 */

export interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
}

export function parseMultipart(body: Buffer, contentType: string | null): MultipartPart[] | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  const boundary = (m?.[1] ?? m?.[2])?.trim();
  if (!boundary) return null;
  const delim = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let pos = body.indexOf(delim);
  if (pos < 0) return null;
  for (;;) {
    pos += delim.length;
    // 終端 `--boundary--`
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break;
    // 区切りの後の CRLF
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;
    else if (body[pos] === 0x0a) pos += 1;
    const next = body.indexOf(delim, pos);
    if (next < 0) return null;
    // 部分の末尾の CRLF を落とす
    let end = next;
    if (body[end - 2] === 0x0d && body[end - 1] === 0x0a) end -= 2;
    else if (body[end - 1] === 0x0a) end -= 1;
    const part = body.subarray(pos, end);
    const sep = part.indexOf("\r\n\r\n");
    const headerText = part.subarray(0, sep < 0 ? part.length : sep).toString("utf8");
    const data = sep < 0 ? Buffer.alloc(0) : part.subarray(sep + 4);
    const disp = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headerText)?.[1] ?? "";
    const name = /name="([^"]*)"/.exec(disp)?.[1];
    const filename = /filename="([^"]*)"/.exec(disp)?.[1];
    const ct = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim();
    if (name !== undefined) parts.push({ name, filename, contentType: ct, data });
    pos = next;
  }
  return parts;
}

/** 名前で 1 つ取る（文字列） */
export function fieldOf(parts: MultipartPart[], name: string): string | null {
  const p = parts.find((x) => x.name === name && x.filename === undefined);
  return p ? p.data.toString("utf8") : null;
}

/** 名前でファイルを 1 つ取る（無い・空なら null） */
export function fileOf(parts: MultipartPart[], name: string): MultipartPart | null {
  const p = parts.find((x) => x.name === name && x.filename !== undefined);
  return p && p.data.length > 0 ? p : null;
}
