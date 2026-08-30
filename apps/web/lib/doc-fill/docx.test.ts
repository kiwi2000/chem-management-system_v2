import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { fillDocx } from "@/lib/doc-fill/docx";
import type { FillInput } from "@/lib/doc-fill/types";

/**
 * Word の様式に値を埋める。
 *
 * 見るのは**表の行が明細の数だけ増えること**と、
 * **書式で切れた札もつながること**。Word はこの2つで壊れる
 */

const P = (...runs: string[]) =>
  `<w:p>${runs.map((t) => `<w:r><w:t>${t}</w:t></w:r>`).join("")}</w:p>`;
const TC = (inner: string) => `<w:tc>${inner}</w:tc>`;
const TR = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;

async function docx(body: string) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function bodyOf(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml")!.async("string");
}

/** `<w:t>` の中身だけを取り出す。組み立てかたを見ずに、出る文字だけを見る */
function texts(xml: string) {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]);
}

function input(file: Buffer, rows: Record<string, string>[]): FillInput {
  return {
    file,
    target: "PRODUCT",
    values: new Map([
      ["product.code", "PR-001"],
      ["product.nameJa", "はんだ & 銅"],
    ]),
    tables: new Map([
      [
        "composition",
        {
          columns: [
            { key: "casNumber", label: "CAS" },
            { key: "name", label: "名称" },
          ],
          rows,
        },
      ],
    ]),
  };
}

const COMPOSITION = [
  { casNumber: "7440-50-8", name: "銅" },
  { casNumber: "7439-92-1", name: "鉛" },
];

describe("fillDocx", () => {
  it("段落の札を埋める。書式で切れていてもつなぐ", async () => {
    const file = await docx(P("コード: ", "{product.", "code}"));
    const out = await fillDocx(input(file, []));
    expect(texts(await bodyOf(out.buffer)).join("")).toBe("コード: PR-001");
  });

  it("値の中の記号を、XMLとして壊さない", async () => {
    const file = await docx(P("{product.nameJa}"));
    const out = await fillDocx(input(file, []));
    const xml = await bodyOf(out.buffer);
    expect(xml).toContain("はんだ &amp; 銅");
    expect(texts(xml).join("")).toBe("はんだ &amp; 銅");
  });

  it("明細の札を置いた行が、行数ぶん増える", async () => {
    const file = await docx(
      `<w:tbl>${TR(TC(P("CAS")), TC(P("名称")))}${TR(TC(P("{composition.casNumber}")), TC(P("{composition.name}")))}</w:tbl>` +
        P("以上"),
    );
    const out = await fillDocx(input(file, COMPOSITION));
    expect(texts(await bodyOf(out.buffer))).toEqual([
      "CAS",
      "名称",
      "7440-50-8",
      "銅",
      "7439-92-1",
      "鉛",
      "以上",
    ]);
  });

  it("明細が0件なら、その行ごと消す", async () => {
    const file = await docx(
      `<w:tbl>${TR(TC(P("CAS")))}${TR(TC(P("{composition.casNumber}")))}</w:tbl>` + P("以上"),
    );
    const out = await fillDocx(input(file, []));
    expect(texts(await bodyOf(out.buffer))).toEqual(["CAS", "以上"]);
  });

  it("入れ子の表があっても、外側の行を数え違えない", async () => {
    const inner = `<w:tbl>${TR(TC(P("内側")))}</w:tbl>`;
    const file = await docx(
      `<w:tbl>${TR(TC(P("{composition.casNumber}") + inner))}</w:tbl>` + P("以上"),
    );
    const out = await fillDocx(input(file, COMPOSITION));
    expect(texts(await bodyOf(out.buffer))).toEqual([
      "7440-50-8",
      "内側",
      "7439-92-1",
      "内側",
      "以上",
    ]);
  });

  it("ヘッダーの札も埋める", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document><w:body>${P("本文")}</w:body></w:document>`);
    zip.file("word/header1.xml", `<w:hdr>${P("{product.code}")}</w:hdr>`);
    const file = await zip.generateAsync({ type: "nodebuffer" });
    const out = await fillDocx(input(file, []));
    const head = await (
      await JSZip.loadAsync(out.buffer)
    )
      .file("word/header1.xml")!
      .async("string");
    expect(texts(head)).toEqual(["PR-001"]);
  });

  it("知らない札は空にして、何が分からなかったかを返す", async () => {
    const file = await docx(P("{product.nosuch}"));
    const out = await fillDocx(input(file, []));
    expect(out.unknown).toEqual(["product.nosuch"]);
    expect(texts(await bodyOf(out.buffer)).join("")).toBe("");
  });
});
