import { normalizeCas, normalizeCode } from "@chem/shared";
import type { QueryColumn } from "@/lib/table-query";

/**
 * 各一覧のサーバー側の列定義。
 * 画面側の列定義とキーを一致させること（一致しない列は黙って無視される）。
 */

export const SUBSTANCE_COLUMNS: QueryColumn[] = [
  // コード・CAS は正規化列で突合する（全角や大小文字の違いを吸収するため）
  { key: "code", kind: "text", field: "codeNormalized", normalize: normalizeCode },
  { key: "casNumber", kind: "text", field: "casNormalized", normalize: normalizeCas },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "status", kind: "enum", field: "status" },
  // 官報公示整理番号は子テーブル。番号で絞り込めるが並べ替えはできない
  {
    key: "gazetteNumbers",
    kind: "text",
    field: "number",
    relation: "gazetteNumbers",
    sortable: false,
  },
  { key: "note", kind: "text", field: "note", caseInsensitive: true },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
];

export const PRODUCT_COLUMNS: QueryColumn[] = [
  { key: "code", kind: "text", field: "codeNormalized", normalize: normalizeCode },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "usableAsMaterial", kind: "enum", field: "usableAsMaterial", booleanEnum: true },
  { key: "privateFlag", kind: "enum", field: "privateFlag", booleanEnum: true },
  {
    key: "compositionPublicFlag",
    kind: "enum",
    field: "compositionPublicFlag",
    booleanEnum: true,
  },
  { key: "status", kind: "enum", field: "status" },
  { key: "note", kind: "text", field: "note", caseInsensitive: true },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
];

export const METAL_FACTOR_COLUMNS: QueryColumn[] = [
  { key: "casNumber", kind: "text", field: "casNormalized", normalize: normalizeCas },
  { key: "metalElement", kind: "text", field: "metalElement" },
  { key: "ratioPct", kind: "number", field: "ratioPct" },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
];

export const NEWS_COLUMNS: QueryColumn[] = [
  { key: "titleJa", kind: "text", field: "titleJa", caseInsensitive: true },
  { key: "status", kind: "enum", field: "status" },
  { key: "pinned", kind: "enum", field: "pinned", booleanEnum: true },
  { key: "publishFrom", kind: "date", field: "publishFrom" },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
];

export const USER_COLUMNS: QueryColumn[] = [
  { key: "email", kind: "text", field: "email", caseInsensitive: true },
  { key: "displayName", kind: "text", field: "displayName", caseInsensitive: true },
  { key: "activeFlag", kind: "enum", field: "activeFlag", booleanEnum: true },
  { key: "lastLoginAt", kind: "date", field: "lastLoginAt" },
];

export const GROUP_COLUMNS: QueryColumn[] = [
  { key: "kind", kind: "enum", field: "kind" },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "displayOrder", kind: "number", field: "displayOrder" },
  { key: "activeFlag", kind: "enum", field: "activeFlag", booleanEnum: true },
];

export const PROPERTY_DEF_COLUMNS: QueryColumn[] = [
  // 用途は節ごとに固定（画面には出さないが、節から必ず条件として送られる）
  { key: "target", kind: "enum", field: "target" },
  { key: "key", kind: "text", field: "key", caseInsensitive: true },
  { key: "labelJa", kind: "text", field: "labelJa", caseInsensitive: true },
  { key: "dataType", kind: "enum", field: "dataType" },
  { key: "defaultUnit", kind: "text", field: "defaultUnit", caseInsensitive: true },
  { key: "displayOrder", kind: "number", field: "displayOrder" },
  { key: "activeFlag", kind: "enum", field: "activeFlag", booleanEnum: true },
];
