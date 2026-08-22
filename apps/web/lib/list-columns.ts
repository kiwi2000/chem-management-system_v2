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
  { key: "publishState", kind: "enum", field: "publishState" },
  // 官報公示整理番号は子テーブル。番号でフィルターできるが並べ替えはできない
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
  { key: "status", kind: "enum", field: "status" },
  { key: "publishState", kind: "enum", field: "publishState" },
  { key: "modelValue", kind: "enum", field: "modelValue" },
  // 用途は子テーブル。「選んだもののどれかを持つ」で絞る
  { key: "uses", kind: "enum", field: "value", relation: "uses", sortable: false },
  // 組成をたどって物質のCAS番号で探す。値は完全一致（正規化して突合）
  {
    key: "casNumbers",
    kind: "list",
    field: "casNormalized",
    normalize: normalizeCas,
    relationPath: ["compositionLines", "substance"],
    sortable: false,
  },
  { key: "note", kind: "text", field: "note", caseInsensitive: true },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
];

export const REGION_COLUMNS: QueryColumn[] = [
  { key: "code", kind: "text", field: "codeNormalized", normalize: normalizeCode },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "displayOrder", kind: "number", field: "displayOrder" },
];

export const COUNTRY_COLUMNS: QueryColumn[] = [
  { key: "code", kind: "text", field: "codeNormalized", normalize: normalizeCode },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  // 地域は選択式。値は地域のIDで送られる
  { key: "regionId", kind: "enum", field: "regionId" },
  { key: "displayOrder", kind: "number", field: "displayOrder" },
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

export const FEEDBACK_COLUMNS: QueryColumn[] = [
  { key: "title", kind: "text", field: "title", caseInsensitive: true },
  { key: "kind", kind: "enum", field: "kind" },
  { key: "priority", kind: "enum", field: "priority" },
  { key: "status", kind: "enum", field: "status" },
  { key: "body", kind: "text", field: "body", caseInsensitive: true },
  { key: "createdAt", kind: "date", field: "createdAt" },
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
