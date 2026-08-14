import { normalizeCas, normalizeCode } from "@chem/shared";
import type { QueryColumn } from "@/lib/table-query";

/**
 * 物質一覧の列定義（サーバー側）。
 * 画面側の列定義（components/substance-table.tsx）とキーを一致させること。
 */
export const SUBSTANCE_COLUMNS: QueryColumn[] = [
  // コード・CAS は正規化列で突合する（全角や大小文字の違いを吸収するため）
  { key: "code", kind: "text", field: "codeNormalized", normalize: normalizeCode },
  { key: "casNumber", kind: "text", field: "casNormalized", normalize: normalizeCas },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "status", kind: "enum", field: "status" },
  { key: "note", kind: "text", field: "note", caseInsensitive: true },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
];
