/**
 * 利用者が作る表（TSV）の列。**日本語と英語のどちらの列名でも受け付け、書き出しは日本語で出す。**
 * 内部の id は列に出さない（決定 0011）。コードの列は任意で、書き出したファイルには入る
 * （名前を直しても同じものとして更新できるように）。
 *
 * 1 行目の列名で表の種類を見分ける（detect.ts）。必須の列が無いときは、その列名を示して止める。
 */

export type TableKind = "REGULATION_LIST" | "PRODUCTS" | "SUBSTANCES";

export interface ColumnDef {
  /** プログラムで使う鍵 */
  key: string;
  /** 受け付ける列名（前後の空白と全角半角の違いは吸収。英語は大文字小文字を問わない） */
  names: readonly string[];
  required?: boolean;
}

/** 規制リスト。1 行 = 法文物質名 1 つ × CAS 1 つ */
export const REGULATION_LIST_COLUMNS: readonly ColumnDef[] = [
  { key: "lawCode", names: ["法律コード", "law_code", "law code"] },
  { key: "law", names: ["法律", "法律名", "law"], required: true },
  { key: "country", names: ["国", "国コード", "country"] },
  {
    key: "categoryCode",
    names: ["規制区分コード", "区分コード", "category_code", "category code"],
  },
  { key: "category", names: ["規制区分", "区分", "category"], required: true },
  { key: "classCode", names: ["分類コード", "class_code", "class code"] },
  { key: "class", names: ["分類", "class"] },
  { key: "number", names: ["番号", "法律上の番号", "official_number", "number"] },
  { key: "substanceCode", names: ["法文物質名コード", "substance_code", "substance code"] },
  {
    key: "substance",
    names: ["法文物質名", "物質名", "substance", "statutory_substance"],
    required: true,
  },
  { key: "cas", names: ["CAS", "CAS番号", "cas_number"], required: true },
  { key: "thresholdLower", names: ["下限値", "閾値下限", "threshold_lower"] },
  { key: "lowerBound", names: ["下限の不等号", "lower_bound"] },
  { key: "thresholdUpper", names: ["上限値", "閾値上限", "threshold_upper"] },
  { key: "upperBound", names: ["上限の不等号", "upper_bound"] },
  { key: "condition", names: ["適用条件", "条件", "condition", "applicable_condition"] },
  { key: "excluded", names: ["非該当", "excluded"] },
  { key: "note", names: ["備考", "note", "remarks"] },
];

/** 製品と組成。製品の行が続き、同じ製品コードの行に組成（CAS か子製品）を書く */
export const PRODUCTS_COLUMNS: readonly ColumnDef[] = [
  { key: "productCode", names: ["製品コード", "product_code", "product code"], required: true },
  { key: "productName", names: ["製品名", "名称", "product_name", "product name", "name"] },
  { key: "productNameEn", names: ["製品名（英語）", "英名", "product_name_en", "name_en"] },
  { key: "model", names: ["型式", "model"] },
  { key: "uses", names: ["用途", "uses", "use"] },
  { key: "usableAsMaterial", names: ["原材料扱い", "usable_as_material"] },
  { key: "status", names: ["状態", "status"] },
  { key: "productNote", names: ["製品の備考", "product_note"] },
  { key: "cas", names: ["CAS", "CAS番号", "cas_number"] },
  { key: "substanceCode", names: ["物質コード", "substance_code", "substance code"] },
  {
    key: "childProductCode",
    names: ["子製品コード", "原材料コード", "child_product_code", "material_code"],
  },
  { key: "contentPct", names: ["含有率", "含有率（%）", "content_pct", "content", "pct"] },
  { key: "lineNote", names: ["組成の備考", "line_note"] },
];

/** 物質マスタ */
export const SUBSTANCES_COLUMNS: readonly ColumnDef[] = [
  { key: "code", names: ["物質コード", "コード", "substance_code", "code"], required: true },
  { key: "nameJa", names: ["名称", "物質名", "名称（日本語）", "name", "name_ja"], required: true },
  { key: "nameEn", names: ["名称（英語）", "英名", "name_en"] },
  { key: "cas", names: ["CAS", "CAS番号", "cas_number"] },
  { key: "aliases", names: ["別名", "aliases"] },
  { key: "note", names: ["備考", "note", "remarks"] },
];

export const TABLE_COLUMNS: Record<TableKind, readonly ColumnDef[]> = {
  REGULATION_LIST: REGULATION_LIST_COLUMNS,
  PRODUCTS: PRODUCTS_COLUMNS,
  SUBSTANCES: SUBSTANCES_COLUMNS,
};

/** 列名の照合用（全角→半角・小文字・空白除去） */
export function normalizeHeaderName(name: string): string {
  return name
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .toLowerCase();
}

export interface HeaderMap {
  /** key → 列の位置 */
  index: Record<string, number>;
  /** 必須なのに無い列（表示用の日本語名） */
  missing: string[];
  /** どの定義にも当たらなかった列名 */
  unknown: string[];
}

/** 1 行目を列の定義に当てはめる */
export function mapHeader(header: string[], columns: readonly ColumnDef[]): HeaderMap {
  const index: Record<string, number> = {};
  const unknown: string[] = [];
  const lookup = new Map<string, string>();
  for (const c of columns) for (const n of c.names) lookup.set(normalizeHeaderName(n), c.key);
  header.forEach((h, i) => {
    if (h === "") return;
    const key = lookup.get(normalizeHeaderName(h));
    if (key === undefined) {
      unknown.push(h);
    } else if (index[key] === undefined) {
      index[key] = i;
    }
  });
  const missing = columns
    .filter((c) => c.required && index[c.key] === undefined)
    .map((c) => c.names[0]!);
  return { index, missing, unknown };
}
