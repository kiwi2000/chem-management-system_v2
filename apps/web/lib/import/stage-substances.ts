import {
  SUBSTANCES_COLUMNS,
  looksLikeCas,
  mapHeader,
  normalizeCas,
  normalizeCode,
  parseTable,
} from "@chem/shared";
import { prisma } from "@/lib/db";
import { diffFields, editedByHuman, type StagedRow } from "@/lib/import/types";

/**
 * 物質の表（TSV）を一時領域の行にする。鍵は物質コード。
 * 別名は「;」区切りで 1 列に書く（反映では、無いものを足すだけ）
 */

export interface SubstancePayload {
  code: string;
  nameJa: string;
  nameEn: string | null;
  casNumber: string | null;
  note: string | null;
  aliases: string[];
}

const FIELDS = ["nameJa", "nameEn", "casNumber", "note"] as const;

export async function stageSubstances(text: string): Promise<{
  rows: StagedRow[];
  errors: { line: number; message: string }[];
  notes: string[];
  count: number;
}> {
  const table = parseTable(text);
  const map = mapHeader(table.header, SUBSTANCES_COLUMNS);
  const errors: { line: number; message: string }[] = [];
  const notes: string[] = [];
  if (map.missing.length > 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: `必須の列がありません: ${map.missing.join("、")}` }],
      notes,
      count: table.rows.length,
    };
  }
  if (map.unknown.length > 0) notes.push(`使わない列: ${map.unknown.join("、")}`);
  const col = (row: string[], k: string) => {
    const i = map.index[k];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  const existing = await prisma.substance.findMany({
    where: { deletedAt: null },
    select: {
      codeNormalized: true,
      nameJa: true,
      nameEn: true,
      casNumber: true,
      note: true,
      updatedBy: true,
    },
  });
  const byCode = new Map(existing.map((s) => [s.codeNormalized, s]));
  const rows: StagedRow[] = [];
  const seen = new Set<string>();
  table.rows.forEach((row, i) => {
    const line = table.lineNumbers[i]!;
    const code = col(row, "code");
    const nameJa = col(row, "nameJa");
    if (!code || !nameJa) {
      errors.push({ line, message: "物質コードか名称が空です" });
      return;
    }
    const codeN = normalizeCode(code);
    if (seen.has(codeN)) {
      errors.push({ line, message: `物質コード「${code}」が表の中で重複しています` });
      return;
    }
    seen.add(codeN);
    const casRaw = col(row, "cas");
    const cas = casRaw ? normalizeCas(casRaw) : null;
    if (cas && !looksLikeCas(cas))
      notes.push(`${line} 行目: CAS「${casRaw}」は一般的な形ではありません（そのまま入れます）`);
    // 空の任意項目は本体の値を残す（製品の表と同じ。列を省いた小さな表で値が消えないように）
    const cur = byCode.get(codeN);
    const payload: SubstancePayload = {
      code,
      nameJa,
      nameEn: col(row, "nameEn") || cur?.nameEn || null,
      casNumber: cas ?? (cur?.casNumber ? normalizeCas(cur.casNumber) : null),
      note: col(row, "note") || cur?.note || null,
      aliases: col(row, "aliases")
        ? col(row, "aliases")
            .split(/[;；]/)
            .map((a) => a.trim())
            .filter(Boolean)
        : [],
    };
    const base = { kind: "substance_master" as const, keyPath: code, label: nameJa, payload };
    if (!cur) {
      rows.push({ ...base, action: "ADD", apply: true });
      return;
    }
    const diff = diffFields(cur, payload as unknown as Record<string, unknown>, FIELDS);
    if (Object.keys(diff).length === 0) rows.push({ ...base, action: "UNCHANGED", apply: false });
    else if (editedByHuman(cur.updatedBy))
      rows.push({
        ...base,
        action: "CONFLICT",
        apply: false,
        diff,
        message: "前回の取り込みのあとに画面で直されています",
      });
    else rows.push({ ...base, action: "UPDATE", apply: true, diff });
  });
  return { rows, errors, notes, count: table.rows.length };
}
