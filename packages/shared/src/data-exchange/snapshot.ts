/**
 * 法規制データの写し（Snapshot）の形。**鍵はコードだけで、内部の id は持たない**
 * （id は環境ごとに違う。決定 0011）。
 *
 * 使うところ:
 *   - tools/precheck … 顧客の写しと当方の正規データの突き合わせ（format = chem-precheck/1）
 *   - データ入出力の「エクスポート」と、当方が渡すデータセット（format = chem-data-set/1）
 *   - データ入出力の「インポート」の下見（同じ形に読み込んでから本体と比べる）
 * 形は同じで、format の印で「何のために作った写しか」を見分ける。
 */

/** tools/precheck が取る写し */
export const SNAPSHOT_FORMAT = "chem-precheck/1";
/** データ入出力で受け渡すデータセット */
export const DATA_SET_FORMAT = "chem-data-set/1";

export type SnapshotFormat = typeof SNAPSHOT_FORMAT | typeof DATA_SET_FORMAT;

export interface LinkSnap {
  version: string;
  source: string;
  cas: string;
  casNumber: string;
  excluded: boolean;
  note: string | null;
  text: string | null;
  textJa: string | null;
}

export interface SubstanceSnap {
  code: string;
  officialNumber: string | null;
  nameOriginal: string;
  nameLang: string;
  nameJa: string | null;
  nameEn: string | null;
  displayOrder: number;
  thresholdLower: string;
  lowerBound: string;
  thresholdUpper: string;
  upperBound: string;
  aggregation: string;
  metalEtc: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  applicableCondition: string | null;
  note: string | null;
  links: LinkSnap[];
}

export interface ClassSnap {
  code: string;
  nameOriginal: string | null;
  nameLang: string | null;
  nameJa: string | null;
  nameEn: string | null;
  displayOrder: number;
  interactionGroup: string | null;
  rank: number | null;
  note: string | null;
  substances: SubstanceSnap[];
}

export interface CategorySnap {
  code: string;
  nameOriginal: string;
  nameLang: string;
  nameJa: string | null;
  nameEn: string | null;
  displayOrder: number;
  thresholdLower: string;
  lowerBound: string;
  thresholdUpper: string;
  upperBound: string;
  aggregation: string;
  metalEtc: string | null;
  thresholdBasis: string;
  judged: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  interactionGroup: string | null;
  rank: number | null;
  score: string;
  note: string | null;
  classes: ClassSnap[];
}

export interface LawSnap {
  code: string;
  countryCode: string;
  nameOriginal: string;
  nameLang: string;
  nameJa: string | null;
  nameEn: string | null;
  displayOrder: number;
  note: string | null;
  categories: CategorySnap[];
}

/** 地域（国内・EU加盟国など）。法律の国が属する */
export interface RegionSnap {
  code: string;
  nameJa: string;
  nameEn: string | null;
  displayOrder: number;
}

/** 国。法律の親 */
export interface CountrySnap {
  code: string;
  regionCode: string;
  nameJa: string;
  nameEn: string | null;
  displayOrder: number;
}

/** 元素（金属換算の換算先）。鍵は元素記号 */
export interface ElementSnap {
  symbol: string;
  atomicNumber: number;
  nameJa: string;
  nameEn: string;
}

/** 金属換算係数。鍵は CAS × 元素 */
export interface MetalFactorSnap {
  cas: string;
  casNumber: string;
  element: string;
  ratioPct: string;
  note: string | null;
}

export interface Snapshot {
  format: SnapshotFormat;
  takenAt: string;
  /** どこから写したか（人が読むためのメモ） */
  label: string;
  versions: { code: string; asOf: string; isCurrent: boolean }[];
  sources: { code: string }[];
  laws: LawSnap[];
  /**
   * 法律が指す地域・国と、判定に要る元素・金属換算係数（2026-09-15 追加）。
   * **空の DB に取り込めるように**入れる（無いと法律が「国がありません」で全部読めない。評価機で実際に起きた）。
   * 古い写しには無いので任意
   */
  regions?: RegionSnap[];
  countries?: CountrySnap[];
  elements?: ElementSnap[];
  metalFactors?: MetalFactorSnap[];
}

/**
 * 項目の影響の分けかた（tools/precheck と取り込みの下見で同じものを使う。決定 0011）
 *   display   … 表示だけ。名称・備考・並び順・番号・結び付きの出典文。判定は変わらない
 *   judgement … 判定が変わる。閾値・合算・金属換算・適用条件・適用開始日／終了日・判定に使うか・
 *               兼ね合い・スコア・結び付きの追加／非該当
 * 知らない項目は安全側で judgement とみなす
 */
export const DISPLAY_FIELDS: ReadonlySet<string> = new Set([
  "nameOriginal",
  "nameLang",
  "nameJa",
  "nameEn",
  "displayOrder",
  "note",
  "officialNumber",
  "countryCode",
  "casNumber",
  "text",
  "textJa",
  "regionCode",
  "atomicNumber",
]);

export const JUDGEMENT_FIELDS: ReadonlySet<string> = new Set([
  "thresholdLower",
  "lowerBound",
  "thresholdUpper",
  "upperBound",
  "aggregation",
  "metalEtc",
  "thresholdBasis",
  "judged",
  "effectiveFrom",
  "effectiveTo",
  "applicableCondition",
  "interactionGroup",
  "rank",
  "score",
  "excluded",
  "ratioPct",
]);

export function impactOfField(field: string): "display" | "judgement" {
  return DISPLAY_FIELDS.has(field) ? "display" : "judgement";
}

/** 項目の日本語名（報告と画面に出す） */
export const FIELD_LABELS_JA: Record<string, string> = {
  nameOriginal: "原文の名称",
  nameLang: "原文の言語",
  nameJa: "名称（日本語）",
  nameEn: "名称（英語）",
  displayOrder: "並び順",
  note: "備考",
  officialNumber: "法律上の番号",
  countryCode: "国",
  casNumber: "CAS の書きかた",
  text: "出典データ",
  textJa: "出典データ（日本語）",
  thresholdLower: "下限値",
  lowerBound: "下限の不等号",
  thresholdUpper: "上限値",
  upperBound: "上限の不等号",
  aggregation: "合算",
  metalEtc: "金属換算",
  thresholdBasis: "閾値の対象",
  judged: "判定に使う",
  effectiveFrom: "適用開始日",
  effectiveTo: "適用終了日",
  applicableCondition: "適用条件",
  interactionGroup: "兼ね合いグループ",
  rank: "rank",
  score: "スコア",
  excluded: "非該当",
  regionCode: "地域",
  atomicNumber: "元素番号",
  ratioPct: "換算係数（%）",
};

/** 受け取った JSON がこの形かどうか（中身の細かい検証は取り込みの側で行う） */
export function isSnapshotLike(v: unknown): v is Snapshot {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    (o.format === SNAPSHOT_FORMAT || o.format === DATA_SET_FORMAT) &&
    Array.isArray(o.laws) &&
    Array.isArray(o.versions) &&
    Array.isArray(o.sources)
  );
}
