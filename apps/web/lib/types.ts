import type { Permission } from "@chem/shared";

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
