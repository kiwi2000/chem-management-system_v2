/** GHS データの画面と API で共有する形（S23 §5-3 の採用結果と、自社判定・採用順） */

export type GhsStatus =
  "CLASSIFIED" | "NOT_CLASSIFIED" | "CANNOT_CLASSIFY" | "NOT_APPLICABLE" | "NOT_EVALUATED";

export interface AdoptedCellDto {
  status: GhsStatus;
  items: { category: string; targetOrgans: string | null; hCodes: string | null }[];
  /** `OVERRIDE`（自社判定）か出典のコード。データなしなら null */
  from: string | null;
  reason?: string;
}

export interface GhsDataRowDto {
  id: string;
  code: string;
  nameJa: string | null;
  nameEn: string | null;
  casNumber: string | null;
  hasOverride: boolean;
  /** クラスコード → 採用した分類 */
  cells: Record<string, AdoptedCellDto>;
}

/** 出典ごとの表の 1 行（出典の項目そのまま） */
export interface GhsSourceRowDto {
  id: string;
  sourceKey: string;
  subKey: string;
  name: string;
  nameEn: string | null;
  cas: string[];
  ecNumber: string | null;
  conditionText: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** CAS で結び付く物質マスタの物質（見られるものだけ） */
  substances: { id: string; code: string }[];
  /** クラスコード → その項目の分類 */
  cells: Record<
    string,
    {
      status: GhsStatus;
      items: {
        category: string;
        targetOrgans: string | null;
        hCodes: string | null;
        minimumClassification: string | null;
      }[];
    }
  >;
}

export interface OverrideDto {
  hazardClass: string;
  category: string;
  status: GhsStatus;
  targetOrgans: string | null;
  hCodes: string | null;
  /** 空＝全ての国 */
  country: string;
  reason: string;
}

export interface AdoptionRuleDto {
  sourceCode: string;
  priority: number;
  fillCannotClassify: boolean;
}

/** 採用順の保存の入力 */
export interface SaveRulesInput {
  country: string;
  rules: { sourceCode: string; fillCannotClassify: boolean }[];
}

/** 自社判定の保存の入力: その物質 × 効く国 の上書きを丸ごと置き換える */
export interface SaveOverridesInput {
  substanceId: string;
  /** 空＝全ての国 */
  country: string;
  reason: string;
  items: {
    hazardClass: string;
    status: GhsStatus;
    category: string;
    targetOrgans: string | null;
  }[];
}
