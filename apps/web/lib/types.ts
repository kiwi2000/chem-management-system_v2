import type { GazetteLawKind, Permission, PropertyDataType, SubstanceStatus } from "@chem/shared";

/**
 * 画面が使う API レスポンスの型。
 * 各ステップで対象の DTO を追記していく（S5 物質 / S7 製品 …）。
 */

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

/** GET /api/me — 画面の出し分け用。認可の判断はサーバー側で別途行う */
export interface MeDto {
  id: string;
  email: string;
  displayName: string | null;
  permissions: Permission[];
  canEdit: boolean;
  isAdmin: boolean;
  preferredLocale: string | null;
}

export interface UserSummaryDto {
  id: string;
  email: string;
  displayName: string | null;
  activeFlag: boolean;
  hasPassword: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  permissions: Permission[];
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SubstanceListItemDto {
  id: string;
  code: string;
  casNumber: string | null;
  status: SubstanceStatus;
  nameJa: string;
  nameEn: string | null;
  subNameCount: number;
}

export interface SubstanceDetailDto extends SubstanceListItemDto {
  note: string | null;
  mainNameJa: string;
  mainNameEn: string | null;
  subNames: { nameJa: string; nameEn: string | null }[];
  gazetteNumbers: { lawKind: GazetteLawKind; number: string }[];
  /** 数値は文字列で受け渡す（浮動小数点を経由させない） */
  properties: {
    propertyDefId: string;
    valueText: string | null;
    valueNum: string | null;
    unit: string | null;
  }[];
  updatedAt: string;
}

export interface PropertyDefDto {
  id: string;
  key: string;
  labelJa: string;
  labelEn: string | null;
  dataType: PropertyDataType;
  defaultUnit: string | null;
  displayOrder: number;
  activeFlag: boolean;
  /** 入力済みの物質数（削除の影響を知らせるため） */
  valueCount: number;
}

export interface NewsDto {
  id: string;
  titleJa: string;
  bodyJa: string;
  titleEn: string | null;
  bodyEn: string | null;
  status: "DRAFT" | "PUBLISHED";
  pinned: boolean;
  /** YYYY-MM-DD（未設定は null） */
  publishFrom: string | null;
  publishUntil: string | null;
  authorId: string;
  authorName: string;
  updatedAt: string;
  /** この閲覧者が編集できるか（サーバー側で判断済み） */
  editable: boolean;
}
