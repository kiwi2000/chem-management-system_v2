import {
  DOCUMENT_TABLE_DEFS,
  ORG_ITEM_PREFIX,
  fieldsFor,
  type DocumentTarget,
  type Locale,
} from "@chem/shared";
import type { RenderInput } from "@/lib/doc-render";

/**
 * プレビュー用の見本の値。
 *
 * **本物のデータは引かない。**様式を組み立てている最中に確かめたいのは
 * 余白・幅・並び・改ページで、そこは見本の値でも同じように出る。
 * 本物を引くと保存が要るうえ、対象を選ぶ手間が入って、
 * 「試しに幅を変えて見る」ができなくなる。
 *
 * **見本と分かる値にする。**本物らしく作り込むと、
 * プレビューの紙面をそのまま配ってしまう事故が起きうる。
 */

/** 差込項目の見本。文字数は本物に近づける（幅の目安になるため） */
const SAMPLE_JA: Record<string, string> = {
  "doc.generatedAt": "2026/01/01 9:00",
  "doc.generatedBy": "見本 太郎",
  "doc.version": "2026Q3",
  "product.code": "PR-0001",
  "product.nameJa": "見本製品 A",
  "product.nameEn": "Sample Product A",
  "product.modelName": "MX-100",
  "product.useName": "塗料、接着剤",
  "product.note": "これは見本です",
  "product.judgementCount": "3",
  "substance.code": "SB-0001",
  "substance.casNumber": "000-00-0",
  "substance.nameJa": "見本物質",
  "substance.nameEn": "Sample substance",
  "substance.note": "これは見本です",
  "org.name": "見本株式会社",
  "org.group": "見本部",
};

const SAMPLE_EN: Record<string, string> = {
  ...SAMPLE_JA,
  "doc.generatedBy": "Sample User",
  "product.nameJa": "Sample Product A",
  "product.useName": "Paint, adhesive",
  "product.note": "This is a sample",
  "substance.nameJa": "Sample substance",
  "substance.note": "This is a sample",
  "org.name": "Sample Co., Ltd.",
  "org.group": "Sample dept.",
};

/**
 * 会社の自由項目の見本。
 * 項目名は会社ごとに違うので、決まった見本を持てない。項目名をそのまま使う
 */
function sampleForOrgItem(label: string, locale: Locale): string {
  return locale === "en" ? `Sample ${label}` : `見本の${label}`;
}

/** その対象で使えるすべての差込項目に、見本の値を入れる */
export function sampleValues(
  target: DocumentTarget,
  orgItems: string[],
  locale: Locale,
): Map<string, string> {
  const table = locale === "en" ? SAMPLE_EN : SAMPLE_JA;
  const out = new Map<string, string>();
  for (const f of fieldsFor(target, orgItems)) {
    if (f.key.startsWith(ORG_ITEM_PREFIX)) {
      out.set(f.key, sampleForOrgItem(f.key.slice(ORG_ITEM_PREFIX.length), locale));
      continue;
    }
    out.set(f.key, table[f.key] ?? (locale === "en" ? "Sample" : "見本"));
  }
  return out;
}

/** 列の見た目に合わせた見本。数字の列に文字が入ると、幅の目安にならない */
function sampleCell(columnKey: string, row: number, locale: Locale): string {
  const en = locale === "en";
  switch (columnKey) {
    case "casNumber":
      return ["000-00-0", "111-11-1", "222-22-2"][row] ?? "000-00-0";
    case "code":
      return `SB-000${row + 1}`;
    case "contentPct":
    case "totalPct":
      return ["55.0", "30.0", "15.0"][row] ?? "10.0";
    case "name":
      return en ? `Sample substance ${row + 1}` : `見本物質 ${row + 1}`;
    case "law":
      return en ? "Sample Act" : "見本法";
    case "category":
      return en ? "Class 1" : "第一種";
    case "officialNumber":
      return `${row + 1}`;
    case "statutoryName":
      return en ? `Sample statutory name ${row + 1}` : `見本の法文物質名 ${row + 1}`;
    case "verdict":
      return en ? "Applicable" : "該当";
    case "needsReview":
      // すべての行に付けない。付いた行と付かない行の見え方を確かめられるように
      return row === 0 ? (en ? "Yes" : "要確認") : "";
    case "inventory":
      return en ? "Sample inventory" : "見本インベントリ";
    case "country":
      return en ? "Japan" : "日本";
    case "value":
      return `0000${row + 1}`;
    case "note":
      return row === 0 ? (en ? "Sample note" : "見本の備考") : "";
    default:
      return en ? "Sample" : "見本";
  }
}

/** 見本の行数。少なすぎると幅が読めず、多いと紙面が見づらい */
const SAMPLE_ROWS = 3;

/** すべての表に見本の行を入れる */
export function sampleTables(locale: Locale): RenderInput["tables"] {
  const out: RenderInput["tables"] = new Map();
  for (const def of DOCUMENT_TABLE_DEFS) {
    const columns = def.columns.map((c) => ({
      key: c.key,
      label: locale === "en" ? c.labelEn : c.labelJa,
    }));
    const rows = Array.from({ length: SAMPLE_ROWS }, (_, i) =>
      Object.fromEntries(columns.map((c) => [c.key, sampleCell(c.key, i, locale)])),
    );
    out.set(def.key, { columns, rows });
  }
  return out;
}
