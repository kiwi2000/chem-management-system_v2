import JSZip from "jszip";
import { classifyTag, findTags, type DocumentTarget } from "@chem/shared";
import { fillDocx } from "@/lib/doc-fill/docx";
import { fillXlsx } from "@/lib/doc-fill/xlsx";
import type { FillInput, FillResult } from "@/lib/doc-fill/types";

/**
 * Excel・Word の様式を預かって、値を埋めて返す。
 *
 * **受け取る前に確かめる。**中身は zip なので、開くだけで害のあるものが混ざりうる。
 * ここを通ったものだけを保存する
 */

export type FileKind = "XLSX" | "DOCX";

/** 1様式あたりの上限。社内の帳票はふつう数百KBで収まる */
export const TEMPLATE_FILE_MAX = 5 * 1024 * 1024;
/** 展開後の合計と、中の項目数。zip 爆弾よけ */
const UNPACKED_MAX = 40 * 1024 * 1024;
const ENTRY_MAX = 2000;

export type FileReject =
  "tooLarge" | "notZip" | "wrongType" | "macro" | "tooManyEntries" | "unpackedTooLarge";

export interface FileReport {
  /** 見つかった札（`{}` を含む形）。書いてある順、重複は落とす */
  tags: string[];
  /** そのうち、こちらが知らないもの */
  unknown: string[];
}

/**
 * 預かる前の検査。
 * **断る理由は1つだけ返す。**直しかたが分かればよく、全部並べる必要はない
 */
export async function inspectTemplateFile(
  file: Buffer,
  kind: FileKind,
  target: DocumentTarget,
  orgItems?: string[],
): Promise<{ ok: false; reason: FileReject } | ({ ok: true } & FileReport)> {
  if (file.length > TEMPLATE_FILE_MAX) return { ok: false, reason: "tooLarge" };

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return { ok: false, reason: "notZip" };
  }

  const names = Object.keys(zip.files);
  if (names.length > ENTRY_MAX) return { ok: false, reason: "tooManyEntries" };
  // マクロ付き（.xlsm / .docm）は受け取らない。開いた人の機械で何でもできてしまう
  if (names.some((n) => n.toLowerCase().endsWith("vbaproject.bin"))) {
    return { ok: false, reason: "macro" };
  }
  const need = kind === "XLSX" ? "xl/workbook.xml" : "word/document.xml";
  if (!names.includes(need)) return { ok: false, reason: "wrongType" };

  let unpacked = 0;
  const tags: string[] = [];
  const seen = new Set<string>();
  const unknown = new Set<string>();
  for (const name of names) {
    const entry = zip.files[name]!;
    if (entry.dir) continue;
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) {
      // 画像などは中を見ない。大きさだけ数える
      const bin = await entry.async("uint8array");
      unpacked += bin.length;
      if (unpacked > UNPACKED_MAX) return { ok: false, reason: "unpackedTooLarge" };
      continue;
    }
    const text = await entry.async("string");
    unpacked += text.length;
    if (unpacked > UNPACKED_MAX) return { ok: false, reason: "unpackedTooLarge" };
    for (const t of findTags(text)) {
      if (seen.has(t.key)) continue;
      seen.add(t.key);
      tags.push(t.raw);
      if (classifyTag(t.key, target, orgItems).kind === "unknown") unknown.add(t.key);
    }
  }

  return { ok: true, tags, unknown: [...unknown] };
}

/** 値を埋める。種類ごとの違いはここから先に出さない */
export function fillTemplateFile(kind: FileKind, input: FillInput): Promise<FillResult> {
  return kind === "XLSX" ? fillXlsx(input) : fillDocx(input);
}

export const TEMPLATE_MIME: Record<FileKind, string> = {
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const TEMPLATE_EXT: Record<FileKind, string> = { XLSX: ".xlsx", DOCX: ".docx" };
