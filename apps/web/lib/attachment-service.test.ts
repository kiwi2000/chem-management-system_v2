import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

// DB を使う関数は読み込むだけで Prisma を起こすので、ここでは形の検査だけを確かめる
vi.mock("@/lib/db", () => ({ prisma: {} }));

const { inspectAttachment } = await import("./attachment-service");

const pdf = Buffer.from("%PDF-1.7\n...");
const POLICY = { attachmentMaxMb: 20, attachmentAllowMacros: false };

async function zip(entries: Record<string, string>): Promise<Buffer> {
  const z = new JSZip();
  for (const [n, v] of Object.entries(entries)) z.file(n, v);
  return z.generateAsync({ type: "nodebuffer" });
}

describe("inspectAttachment", () => {
  it("PDF を受け付け、形式を返す", async () => {
    expect(await inspectAttachment("仕入先SDS.pdf", pdf, POLICY)).toEqual({
      ok: true,
      mime: "application/pdf",
    });
  });

  it("拡張子は大文字でもよい", async () => {
    expect((await inspectAttachment("A.PDF", pdf, POLICY)).ok).toBe(true);
  });

  it("空のファイルは断る", async () => {
    expect(await inspectAttachment("a.pdf", Buffer.alloc(0), POLICY)).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("20 MB を超えたら断る", async () => {
    const big = Buffer.alloc(20 * 1024 * 1024 + 1);
    big.write("%PDF");
    expect(await inspectAttachment("a.pdf", big, POLICY)).toEqual({
      ok: false,
      reason: "tooLarge",
    });
  });

  it("知らない形式は断り、マクロ付きの拡張子はマクロとして断る", async () => {
    expect(await inspectAttachment("a.exe", pdf, POLICY)).toEqual({ ok: false, reason: "badType" });
    expect(await inspectAttachment("a.xlsm", pdf, POLICY)).toEqual({ ok: false, reason: "macro" });
    expect(await inspectAttachment("noext", pdf, POLICY)).toEqual({ ok: false, reason: "badType" });
  });

  it("拡張子と中身が合わなければ断る", async () => {
    expect(await inspectAttachment("a.pdf", Buffer.from("MZ...."), POLICY)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("docx・xlsx はマクロの本体が入っていたら断る", async () => {
    const clean = await zip({ "word/document.xml": "<w:document/>" });
    const macro = await zip({ "word/document.xml": "<w:document/>", "word/vbaProject.bin": "x" });
    expect((await inspectAttachment("a.docx", clean, POLICY)).ok).toBe(true);
    expect(await inspectAttachment("a.docx", macro, POLICY)).toEqual({
      ok: false,
      reason: "macro",
    });
  });

  it("古い形式の doc・xls も、マクロの印があれば断る", async () => {
    const head = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const plain = Buffer.concat([head, Buffer.alloc(64)]);
    const macro = Buffer.concat([head, Buffer.from("_VBA_PROJECT", "utf16le")]);
    expect((await inspectAttachment("a.xls", plain, POLICY)).ok).toBe(true);
    expect(await inspectAttachment("a.xls", macro, POLICY)).toEqual({ ok: false, reason: "macro" });
  });

  it("テキストは中身の印を見ない", async () => {
    expect(await inspectAttachment("memo.txt", Buffer.from("メモ"), POLICY)).toEqual({
      ok: true,
      mime: "text/plain",
    });
  });

  describe("システム設定に従う", () => {
    it("上限は設定の MB で決まる", async () => {
      const twoMb = Buffer.alloc(2 * 1024 * 1024);
      twoMb.write("%PDF");
      const tight = { attachmentMaxMb: 1, attachmentAllowMacros: false };
      const loose = { attachmentMaxMb: 3, attachmentAllowMacros: false };
      expect(await inspectAttachment("a.pdf", twoMb, tight)).toEqual({
        ok: false,
        reason: "tooLarge",
      });
      expect((await inspectAttachment("a.pdf", twoMb, loose)).ok).toBe(true);
    });

    it("マクロ付きを許せば、docm・xlsm とマクロ入りの docx・xls を受け付ける", async () => {
      const allow = { attachmentMaxMb: 20, attachmentAllowMacros: true };
      const macro = await zip({ "word/document.xml": "<w:document/>", "word/vbaProject.bin": "x" });
      const ole = Buffer.concat([
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
        Buffer.from("_VBA_PROJECT", "utf16le"),
      ]);
      expect(await inspectAttachment("a.docm", macro, allow)).toEqual({
        ok: true,
        mime: "application/vnd.ms-word.document.macroEnabled.12",
      });
      expect((await inspectAttachment("a.docx", macro, allow)).ok).toBe(true);
      expect((await inspectAttachment("a.xls", ole, allow)).ok).toBe(true);
    });

    it("許していなければ、docm・xlsm はマクロ付きとして断る", async () => {
      const macro = await zip({ "xl/workbook.xml": "<w/>" });
      expect(await inspectAttachment("a.xlsm", macro, POLICY)).toEqual({
        ok: false,
        reason: "macro",
      });
    });

    it("マクロを許しても、中身の頭の印が合わなければ断る", async () => {
      const allow = { attachmentMaxMb: 20, attachmentAllowMacros: true };
      expect(await inspectAttachment("a.xlsm", Buffer.from("MZ"), allow)).toEqual({
        ok: false,
        reason: "mismatch",
      });
    });
  });
});
